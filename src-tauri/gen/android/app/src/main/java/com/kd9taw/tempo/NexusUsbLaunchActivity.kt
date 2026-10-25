package com.kd9taw.tempo

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.UUID

/** Process-local routing only. This name is NEVER a permission: the native USB
 * connection rechecks the current device, VID/PID, endpoints and OS grant on open.
 */
internal object NexusUsbSelection {
  @Volatile var deviceName: String? = null
    private set

  fun choose(manager: UsbManager, name: String): Boolean {
    if (NexusLaunchState.mainEntered) return false
    val device = manager.deviceList[name] ?: return false
    if (device.vendorId != 0x0403 || device.productId != 0x601c || !manager.hasPermission(device)) return false
    deviceName = name
    return true
  }
}

/** App-private native preflight, never a replacement Tauri host. No native
 * library, station engine, CAT, capture or SPI I/O starts here. Only a user click
 * may request a grant. Warm entry returns Main without a prompt over Stop.
 */
class NexusUsbLaunchActivity : Activity() {
  private lateinit var manager: UsbManager
  private lateinit var content: LinearLayout
  private var contentInsets: NexusWindowInsets? = null
  private var registered = false
  private var handedOff = false
  private var pending: String? = null
  private var denied = false
  private var lostFocusWhilePending = false
  private var action = ""

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action == action && pending != null) completeChoice()
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    manager = getSystemService(Context.USB_SERVICE) as UsbManager
    pending = savedInstanceState?.getString("nexus.usb.pending")
    denied = savedInstanceState?.getBoolean("nexus.usb.denied") ?: false
    lostFocusWhilePending = savedInstanceState?.getBoolean("nexus.usb.lostFocus") ?: false
    action = savedInstanceState?.getString("nexus.usb.action")
      ?: "$packageName.USB_PERMISSION.${UUID.randomUUID()}"
    if (NexusLaunchState.mainEntered || (pending == null && candidates(this).isEmpty())) {
      openMain()
      return
    }
    // Private dynamic receiver and package-bound immutable PendingIntent. Broadcast
    // extras cannot authorize a device; completeChoice rechecks the actual manager.
    registerReceiver(receiver, IntentFilter(action), Context.RECEIVER_NOT_EXPORTED)
    registered = true
    content = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      val padding = (24 * resources.displayMetrics.density).toInt()
      setPadding(padding, padding, padding, padding)
    }
    setContentView(ScrollView(this).apply { isFillViewport = true; addView(content) })
    contentInsets = NexusWindowInsets(findViewById(android.R.id.content))
    render()
  }

  override fun onResume() {
    super.onResume()
    if (handedOff) return
    if (NexusLaunchState.mainEntered) { openMain(); return }
    val name = pending
    if (name != null) {
      val device = manager.deviceList[name]
      if (device == null || manager.hasPermission(device)) completeChoice()
    } else if (::content.isInitialized) {
      render()
    }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (pending == null || handedOff) return
    if (!hasFocus) lostFocusWhilePending = true
    else if (lostFocusWhilePending) completeChoice()
  }

  private fun render() {
    if (handedOff || !::content.isInitialized) return
    content.removeAllViews()
    content.addView(TextView(this).apply { text = getString(R.string.nexus_usb_title); textSize = 24f })
    content.addView(TextView(this).apply { text = getString(R.string.nexus_usb_reason); textSize = 16f })
    content.addView(TextView(this).apply {
      tag = "nexus-usb-status"
      text = when {
        pending != null -> getString(R.string.nexus_usb_waiting)
        denied -> getString(R.string.nexus_usb_denied)
        else -> ""
      }
    })
    for (device in candidates(this)) {
      addButton("nexus-usb-device-${device.deviceName}", getString(R.string.nexus_usb_use, device.deviceName)) {
        ask(device.deviceName)
      }
    }
    addButton("nexus-usb-continue", getString(R.string.nexus_usb_continue)) { openMain() }
  }

  private fun addButton(name: String, caption: String, act: () -> Unit) {
    content.addView(Button(this).apply {
      tag = name
      text = caption
      minHeight = (48 * resources.displayMetrics.density).toInt()
      isEnabled = pending == null
      setOnClickListener { if (pending == null) act() }
    }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
  }

  private fun ask(name: String) {
    if (handedOff || isFinishing || isDestroyed || pending != null) return
    if (NexusLaunchState.mainEntered) { openMain(); return }
    val device = candidates(this).singleOrNull { it.deviceName == name }
    if (device == null) { denied = true; render(); return }
    if (manager.hasPermission(device)) {
      if (NexusUsbSelection.choose(manager, name)) openMain()
      return
    }
    pending = name
    lostFocusWhilePending = false
    render()
    try {
      val reply = PendingIntent.getBroadcast(this, 0, Intent(action).setPackage(packageName),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_CANCEL_CURRENT)
      manager.requestPermission(device, reply)
    } catch (_: RuntimeException) {
      pending = null
      denied = true
      render()
    }
  }

  private fun completeChoice() {
    if (handedOff || isFinishing || isDestroyed) return
    val name = pending ?: return
    pending = null
    lostFocusWhilePending = false
    if (NexusLaunchState.mainEntered) { openMain(); return }
    // Deliberately ignore EXTRA_PERMISSION_GRANTED and EXTRA_DEVICE. A forged,
    // late or mismatched callback cannot manufacture Android authority.
    if (NexusUsbSelection.choose(manager, name)) openMain()
    else { denied = true; render() }
  }

  private fun openMain() {
    if (handedOff || isFinishing || isDestroyed) return
    handedOff = true
    startActivity(Intent().setClassName(this, "$packageName.MainActivity")
      .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    finish()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    outState.putString("nexus.usb.pending", pending)
    outState.putString("nexus.usb.action", action)
    outState.putBoolean("nexus.usb.denied", denied)
    outState.putBoolean("nexus.usb.lostFocus", lostFocusWhilePending)
    super.onSaveInstanceState(outState)
  }

  override fun onDestroy() {
    if (registered) { unregisterReceiver(receiver); registered = false }
    contentInsets?.close()
    contentInsets = null
    super.onDestroy()
  }

  companion object {
    internal fun candidates(context: Context): List<UsbDevice> {
      val manager = context.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return emptyList()
      return manager.deviceList.values.filter { it.vendorId == 0x0403 && it.productId == 0x601c }
        .sortedBy { it.deviceName }
    }

    internal fun destination(context: Context): String {
      if (NexusLaunchState.mainEntered) return "MainActivity"
      val manager = context.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return "MainActivity"
      val devices = candidates(context)
      if (devices.isEmpty() || (devices.size == 1 && manager.hasPermission(devices.single()))) return "MainActivity"
      return "NexusUsbLaunchActivity"
    }
  }
}
