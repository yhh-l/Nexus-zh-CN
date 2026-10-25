package com.kd9taw.tempo

import com.kd9taw.tempo.Ft4222Descriptors.device
import com.kd9taw.tempo.Ft4222Descriptors.endpoint
import android.content.Context
import android.hardware.usb.*
import android.os.Binder
import android.os.Parcel
import android.os.Parcelable
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements

/** Actual product class + Android descriptors/UsbManager, with only the hardware I/O
 * shadowed. No Tauri stub, USB controller, station engine, audio or RF is executed.
 * The latch proves IN executes while OUT is blocked, not just a scripted read result.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [Ft4222Wire::class])
class NexusFt4222UsbTest {
  private lateinit var manager: UsbManager

  @Before fun reset() {
    manager = RuntimeEnvironment.getApplication().getSystemService(Context.USB_SERVICE) as UsbManager
    Ft4222Wire.reset()
    NexusUsbSelection::class.java.getDeclaredField("deviceName").apply { isAccessible = true }.set(null, null)
  }

  private fun grant(device: UsbDevice = device(), permission: Boolean = true): UsbDevice {
    shadowOf(manager).addOrUpdateUsbDevice(device, permission)
    return device
  }

  private fun expectIo(block: () -> Unit) {
    try { block(); fail("Expected an I/O refusal") }
    catch (_: IOException) { /* expected, not a framework/compilation error */ }
  }

  private fun ready(): Pair<NexusFt4222Usb, ByteArray> {
    val wire = ByteArrayOutputStream()
    ByteArray(8192) { (it % 251).toByte() }.asList().chunked(510).forEach { payload ->
      wire.write(byteArrayOf(2, 0)); wire.write(payload.toByteArray())
    }
    val raw = wire.toByteArray()
    raw.asList().chunked(2048).forEach { Ft4222Wire.input.add(it.toByteArray()) }
    val device = grant()
    return NexusFt4222Usb.openGranted(manager, device.deviceName) to raw
  }

  @Test fun deniedUsbAuthorityNeverOpensOrClaimsTheDevice() {
    val device = grant(permission = false)
    expectIo { NexusFt4222Usb.openGranted(manager, device.deviceName).close() }
    assertEquals(0, Ft4222Wire.claims.get())
    assertEquals(0, Ft4222Wire.closes.get())
  }

  @Test fun unrelatedDeviceAndInvalidEndpointsAreRefusedBeforeClaim() {
    for (device in listOf(
      device(product = 0x6010),
      device(endpoints = arrayOf(endpoint(0x81), endpoint(0x82))),
      device(endpoints = arrayOf(endpoint(0x81, type = 3), endpoint(0x02))),
      device(endpoints = arrayOf(endpoint(0x81, packet = 1024), endpoint(0x02))),
    )) {
      grant(device)
      expectIo { NexusFt4222Usb.openGranted(manager, device.deviceName).close() }
    }
    assertEquals(0, Ft4222Wire.claims.get())
  }

  @Test fun nativeFactoryAcceptsOnlyOneActuallyGrantedBridge() {
    val context = RuntimeEnvironment.getApplication()
    expectIo { NexusFt4222Usb.openOnlyGranted(context).close() }
    grant(permission = false)
    expectIo { NexusFt4222Usb.openOnlyGranted(context).close() }
    grant()
    NexusFt4222Usb.openOnlyGranted(context).close()
    assertEquals(1, Ft4222Wire.claims.get())
    grant(device(name = "/dev/bus/usb/001/003"))
    expectIo { NexusFt4222Usb.openOnlyGranted(context).close() }
    assertEquals(1, Ft4222Wire.claims.get())
  }
  @Test fun explicitPreflightSelectionRoutesTheFactoryWithoutFirstDeviceGuessing() {
    NexusLaunchState::class.java.getDeclaredField("mainEntered").apply { isAccessible = true }.setBoolean(null, false)
    grant()
    val second = grant(device(name = "/dev/bus/usb/001/003"))
    assertTrue(NexusUsbSelection.choose(manager, second.deviceName))
    NexusFt4222Usb.openOnlyGranted(RuntimeEnvironment.getApplication()).close()
    assertEquals(1, Ft4222Wire.claims.get())
    shadowOf(manager).addOrUpdateUsbDevice(second, false)
    expectIo { NexusFt4222Usb.openOnlyGranted(RuntimeEnvironment.getApplication()).close() }
    assertEquals(1, Ft4222Wire.claims.get()) // Never falls back to the other granted device.
  }
  @Test fun busyInterfaceClosesWithoutForcingOffAnyKernelDriver() {
    val device = grant()
    Ft4222Wire.claimOk = false
    expectIo { NexusFt4222Usb.openGranted(manager, device.deviceName).close() }
    assertEquals(1, Ft4222Wire.claims.get())
    assertFalse(Ft4222Wire.forced)
    assertEquals(1, Ft4222Wire.closes.get())
  }

  @Test fun realProductReadsConcurrentlyAndPreservesShortTransferBoundaries() {
    val (usb, raw) = ready()
    usb.use {
      assertEquals(512, it.packetBytes())
      val transfers = it.readRaw()
      assertArrayEquals(raw, transfers.flatMap { b -> b.asList() }.toByteArray())
      assertEquals(raw.size % 2048, transfers.last().size)
      assertArrayEquals(ByteArray(8192) { 0xff.toByte() }, Ft4222Wire.output.toByteArray())
      assertEquals(1, Ft4222Wire.csEnds.get())
      assertFalse(Ft4222Wire.forced)
      assertEquals(0, Ft4222Wire.interfaceId)
      assertTrue(Ft4222Wire.timeouts.all { t -> t in 1..1000 })
    }
    assertEquals(1, Ft4222Wire.closes.get())
  }

  @Test fun partialWritesStillClockExactly8192BytesAndEndChipSelect() {
    Ft4222Wire.maximumWrite = 73
    val (usb, _) = ready()
    usb.use { it.readRaw() }
    assertEquals(8192, Ft4222Wire.output.size())
    assertEquals(1, Ft4222Wire.csEnds.get())
  }

  @Test fun failedCsReleaseInvalidatesEvenACompleteInputTransaction() {
    Ft4222Wire.releaseOk = false
    val (usb, _) = ready()
    expectIo { usb.readRaw() }
    expectIo { usb.readRaw() }
    assertEquals(1, Ft4222Wire.closes.get())
  }

  @Test fun disconnectOrStatusOnlyStreamNeverReturnsFabricatedSpectrum() {
    for (statusOnly in listOf(false, true)) {
      Ft4222Wire.reset()
    NexusUsbSelection::class.java.getDeclaredField("deviceName").apply { isAccessible = true }.set(null, null)
      val device = grant()
      if (statusOnly) repeat(65) { Ft4222Wire.input.add(byteArrayOf(2, 0)) }
      val usb = NexusFt4222Usb.openGranted(manager, device.deviceName)
      expectIo { usb.readRaw() }
      usb.close()
      assertEquals(1, Ft4222Wire.closes.get())
    }
  }

  @Test fun failedControlClosesAndCannotBeRetriedAsSuccess() {
    val device = grant()
    val usb = NexusFt4222Usb.openGranted(manager, device.deviceName)
    usb.controlOut(0x21, 0x0145, 1)
    assertEquals(listOf(0x40, 0x21, 0x0145, 1, 0, 1000), Ft4222Wire.lastControl)
    Ft4222Wire.controlOk = false
    expectIo { usb.controlOut(0x21, 0x0146, 1) }
    expectIo { usb.controlOut(0x21, 0x0146, 1) }
    usb.close()
    assertEquals(1, Ft4222Wire.closes.get())
  }
}

/** Test-only syscall boundary, not a substitute product transport. */
@Implements(UsbDeviceConnection::class)
class Ft4222Wire {
  @Implementation fun claimInterface(face: UsbInterface, force: Boolean): Boolean {
    claims.incrementAndGet(); forced = force; interfaceId = face.id
    return claimOk
  }
  @Implementation fun close() { closes.incrementAndGet(); readStarted.countDown() }
  @Implementation fun controlTransfer(type: Int, request: Int, value: Int, index: Int, bytes: ByteArray?, length: Int, timeout: Int): Int {
    lastControl = listOf(type, request, value, index, length, timeout)
    return if (controlOk) 0 else -1
  }
  @Implementation fun bulkTransfer(endpoint: UsbEndpoint, bytes: ByteArray, length: Int, timeout: Int): Int =
    bulkTransfer(endpoint, bytes, 0, length, timeout)

  @Implementation fun bulkTransfer(endpoint: UsbEndpoint, bytes: ByteArray, offset: Int, length: Int, timeout: Int): Int {
    timeouts.add(timeout)
    if (endpoint.direction == UsbConstants.USB_DIR_IN) {
      readStarted.countDown()
      val transfer = input.poll() ?: return -1
      transfer.copyInto(bytes, offset)
      return transfer.size
    }
    if (length == 0) { csEnds.incrementAndGet(); return if (releaseOk) 0 else -1 }
    // A serial OUT-then-IN product implementation would fail this actual latch.
    if (!readStarted.await(1, TimeUnit.SECONDS)) return -1
    val written = minOf(length, maximumWrite)
    output.write(bytes, offset, written)
    return written
  }

  companion object {
    val input = ConcurrentLinkedQueue<ByteArray>()
    val output = ByteArrayOutputStream()
    val claims = AtomicInteger()
    val closes = AtomicInteger()
    val csEnds = AtomicInteger()
    val timeouts = ConcurrentLinkedQueue<Int>()
    var readStarted = CountDownLatch(1)
    var forced = false
    var interfaceId = -1
    var claimOk = true
    var releaseOk = true
    var controlOk = true
    var maximumWrite = Int.MAX_VALUE
    var lastControl = emptyList<Int>()
    fun reset() {
      input.clear(); output.reset(); claims.set(0); closes.set(0); csEnds.set(0); timeouts.clear()
      readStarted = CountDownLatch(1); forced = false; interfaceId = -1
      claimOk = true; releaseOk = true; controlOk = true; maximumWrite = Int.MAX_VALUE
      lastControl = emptyList()
    }
  }
}

/** Original serialized Android descriptors shared by modeled USB tests. */
object Ft4222Descriptors {
  private fun <T> parcelled(creator: Parcelable.Creator<T>, fill: (Parcel) -> Unit): T {
    val parcel = Parcel.obtain()
    try {
      fill(parcel)
      parcel.setDataPosition(0)
      return creator.createFromParcel(parcel)
    } finally { parcel.recycle() }
  }

  fun endpoint(address: Int, type: Int = 2, packet: Int = 512): UsbEndpoint =
    parcelled(UsbEndpoint.CREATOR) { p ->
      p.writeInt(address); p.writeInt(type); p.writeInt(packet); p.writeInt(0)
    }

  fun device(product: Int = 0x601c, endpoints: Array<UsbEndpoint> = arrayOf(endpoint(0x81), endpoint(0x02)), name: String = "/dev/bus/usb/001/002"): UsbDevice {
    val face = parcelled(UsbInterface.CREATOR) { p ->
      p.writeInt(0); p.writeInt(0); p.writeString("A")
      p.writeInt(255); p.writeInt(0); p.writeInt(0)
      p.writeParcelableArray(endpoints, 0)
    }
    val configuration = parcelled(UsbConfiguration.CREATOR) { p ->
      p.writeInt(1); p.writeString("test"); p.writeInt(0x80); p.writeInt(50)
      p.writeParcelableArray(arrayOf(face), 0)
    }
    return parcelled(UsbDevice.CREATOR) { p ->
      p.writeString(name); p.writeInt(0x0403); p.writeInt(product)
      p.writeInt(0); p.writeInt(0); p.writeInt(0)
      p.writeString("test"); p.writeString("FT4222"); p.writeString("1.0")
      // Test-only serial-reader binder; no PII or serial-number query is made.
      p.writeStrongBinder(Binder())
      p.writeParcelableArray(arrayOf(configuration), 0)
      repeat(5) { p.writeInt(0) }
    }
  }

}
