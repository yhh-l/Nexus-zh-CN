package com.kd9taw.tempo

import android.content.Context
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbManager
import java.io.Closeable
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Original Nexus USB Host transport, no D2XX, libusb binary or desktop library.
 * Opens ONLY a named, already OS-granted FT4222 interface A; never requests a grant
 * or takes a sibling CAT/audio interface away from its driver. The native scope
 * worker owns this connection through JNI and the existing WaterfallSource.
 *
 * SPI is full duplex: blocking on all 8192 OUT bytes before draining IN can deadlock
 * the USB FIFOs. One owned writer runs beside the caller's reads, under the SAME
 * monotonic deadline. Each raw IN transfer retains its short-packet boundary for
 * yaesu_wf::usb_protocol. A zero-length OUT ends CS, including after write failure.
 * This controls only the scope SPI bridge, not radio CAT/PTT or transmit timing.
 */
class NexusFt4222Usb private constructor(
  private val connection: UsbDeviceConnection,
  private val input: UsbEndpoint,
  private val output: UsbEndpoint,
) : Closeable {
  private val closed = AtomicBoolean(false)
  private val writer = Executors.newSingleThreadExecutor { task ->
    Thread(task, "nexus-ft4222-out").apply { isDaemon = true }
  }
  private val inFlight = AtomicReference<Future<*>?>(null)

  fun packetBytes(): Int = input.maxPacketSize

  /** No data stage: zero is success, a negative result is NOT a successful write. */
  @Synchronized fun controlOut(request: Int, value: Int, index: Int) {
    checkOpen()
    require(request == 0x00 || request == 0x21) { "Not an FT4222 OUT request" }
    require(value in 0..65535 && index in 0..1) { "Invalid FT4222 setup packet" }
    try {
      if (connection.controlTransfer(0x40, request, value, index, null, 0, 1000) != 0) {
        throw IOException("FT4222 control transfer failed")
      }
    } catch (error: Exception) {
      close()
      throw error
    }
  }

  /** Returns separate, actual-length raw USB transfers, NEVER padded spectrum data.
   * The Rust packet decoder must still strip every packet's two status bytes and
   * the existing frame accumulator must still realign to the FT-710 trailer.
   */
  @Synchronized fun readRaw(): Array<ByteArray> {
    checkOpen()
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
    try {
      val writing = writer.submit { clockRead(deadline) }
      inFlight.set(writing)
      if (closed.get()) throw IOException("FT4222 connection closed")
      val transfers = ArrayList<ByteArray>()
      val buffer = ByteArray(2048)
      var payload = 0
      var emptyReads = 0
      while (payload < READ_BYTES) {
        val count = connection.bulkTransfer(input, buffer, buffer.size, timeout(deadline))
        if (count < 0 || count > buffer.size) throw IOException("FT4222 bulk IN failed")
        var added = 0
        var offset = 0
        while (offset < count) {
          val packet = minOf(input.maxPacketSize, count - offset)
          if (packet < 2) throw IOException("FT4222 short packet lacks status bytes")
          added += packet - 2
          offset += packet
        }
        if (added == 0) {
          if (++emptyReads > 64) throw IOException("FT4222 supplied no SPI data")
        } else {
          emptyReads = 0
          if (added > READ_BYTES - payload) throw IOException("FT4222 SPI read overflow")
          transfers.add(buffer.copyOf(count))
          payload += added
        }
      }
      // Also prove OUT completion and the zero-length CS release before accepting IN.
      writing.get(remaining(deadline), TimeUnit.NANOSECONDS)
      inFlight.set(null)
      return transfers.toTypedArray()
    } catch (error: Exception) {
      close()
      throw IOException("FT4222 transaction failed", error)
    }
  }

  private fun clockRead(deadline: Long) {
    val dummy = ByteArray(READ_BYTES) { 0xff.toByte() }
    var offset = 0
    var failure: Exception? = null
    try {
      while (offset < dummy.size) {
        checkOpen()
        val count = connection.bulkTransfer(output, dummy, offset, dummy.size - offset, timeout(deadline))
        if (count <= 0 || count > dummy.size - offset) throw IOException("FT4222 bulk OUT failed")
        offset += count
      }
    } catch (error: Exception) {
      failure = error
    } finally {
      // Don't issue further I/O after an explicit close/detach cancellation.
      if (!closed.get()) {
        try {
          if (connection.bulkTransfer(output, ByteArray(0), 0, 250) != 0) {
            throw IOException("FT4222 chip-select release failed")
          }
        } catch (release: Exception) {
          if (failure == null) failure = release else failure.addSuppressed(release)
        }
      }
    }
    failure?.let { throw it }
  }

  private fun remaining(deadline: Long): Long {
    val left = deadline - System.nanoTime()
    if (left <= 0) throw IOException("FT4222 transaction deadline exceeded")
    return left
  }

  private fun timeout(deadline: Long): Int =
    TimeUnit.NANOSECONDS.toMillis(remaining(deadline)).coerceIn(1, 1000).toInt()

  private fun checkOpen() {
    if (closed.get()) throw IOException("FT4222 connection closed")
  }

  /** close() is deliberately NOT synchronized: it cancels a blocked readRaw().
   * Android closes the file descriptor and releases its claimed interfaces. No
   * join on the UI thread, no unbounded Future wait, no reuse after any failure.
   */
  override fun close() {
    if (closed.compareAndSet(false, true)) {
      inFlight.getAndSet(null)?.cancel(true)
      writer.shutdownNow()
      connection.close()
    }
  }

  companion object {
    private const val READ_BYTES = 8192

    /** Called by the native scope worker; no Android dialog or Activity launch here.
     * Multiple authorized bridges require explicit radio selection, never first-device wins.
     */
    @JvmStatic fun openOnlyGranted(context: Context): NexusFt4222Usb {
      val manager = context.getSystemService(Context.USB_SERVICE) as UsbManager
      val devices = manager.deviceList.values.filter {
        it.vendorId == 0x0403 && it.productId == 0x601c && manager.hasPermission(it)
      }
      if (devices.size != 1) throw IOException("Connect and authorize exactly one FT4222 before starting the scope")
      return openGranted(manager, devices.single().deviceName)
    }
    @JvmStatic fun openGranted(manager: UsbManager, deviceName: String): NexusFt4222Usb {
      val device = manager.deviceList[deviceName] ?: throw IOException("FT4222 disconnected")
      if (device.vendorId != 0x0403 || device.productId != 0x601c) {
        throw IOException("Selected USB device is not an FT4222")
      }
      if (!manager.hasPermission(device)) throw IOException("Android USB permission required")
      val interfaces = (0 until device.interfaceCount).map { device.getInterface(it) }
        .filter { it.id == 0 && it.alternateSetting == 0 }
      if (interfaces.size != 1) throw IOException("FT4222 interface A is missing or ambiguous")
      val face = interfaces.single()
      if (face.interfaceClass != UsbConstants.USB_CLASS_VENDOR_SPEC || face.endpointCount != 2) {
        throw IOException("Unexpected FT4222 interface A descriptor")
      }
      val endpoints = (0 until face.endpointCount).map { face.getEndpoint(it) }
      if (endpoints.any { it.endpointNumber == 0 || it.type != UsbConstants.USB_ENDPOINT_XFER_BULK || it.maxPacketSize !in listOf(64, 512) }) {
        throw IOException("Invalid FT4222 bulk endpoint")
      }
      val input = endpoints.singleOrNull { it.direction == UsbConstants.USB_DIR_IN }
        ?: throw IOException("FT4222 bulk IN is missing or ambiguous")
      val output = endpoints.singleOrNull { it.direction == UsbConstants.USB_DIR_OUT }
        ?: throw IOException("FT4222 bulk OUT is missing or ambiguous")
      val connection = manager.openDevice(device) ?: throw IOException("Cannot open FT4222")
      try {
        // force=false: never detach a kernel driver, and never claim CAT/audio interfaces.
        if (!connection.claimInterface(face, false)) throw IOException("FT4222 interface A is busy")
        return NexusFt4222Usb(connection, input, output)
      } catch (error: Exception) {
        connection.close()
        throw error
      }
    }
  }
}
