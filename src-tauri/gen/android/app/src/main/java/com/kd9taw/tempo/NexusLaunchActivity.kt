package com.kd9taw.tempo

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Looper
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Process-local, one-way latch: once the real host entered, never cover it with a permission UI.
 * Not a transmit latch; it neither grants permission nor changes the native engine's safeguards.
 * Deliberately not reset on Activity destruction: native workers can outlive a WebView.
 */
internal object NexusLaunchState {
  var mainEntered = false
    private set

  fun enterMain() {
    check(Looper.myLooper() == Looper.getMainLooper())
    mainEntered = true
  }
}

/** Native preflight ONLY, before TauriActivity/native station startup.
 * No WebView, library loading, engine invoke, capture, credentials or RF operations here.
 * The private MainActivity is launched only explicitly, preserving its existing singleTask host.
 * Denial is respected: users can continue, but local capture remains subject to Android permission.
 */
class NexusLaunchActivity : Activity() {
  private var contentInsets: NexusWindowInsets? = null
  private var pending = false
  private var denied = false
  private var handedOff = false
  private lateinit var request: Button
  private lateinit var proceed: Button
  private lateinit var status: TextView

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (NexusLaunchState.mainEntered || hasMicrophone()) {
      openMain()
      return
    }
    pending = savedInstanceState?.getBoolean("nexus.microphone.pending") ?: false
    denied = savedInstanceState?.getBoolean("nexus.microphone.denied") ?: false
    val content = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      val padding = (24 * resources.displayMetrics.density).toInt()
      setPadding(padding, padding, padding, padding)
    }
    content.addView(TextView(this).apply {
      text = getString(R.string.nexus_microphone_title)
      textSize = 24f
    })
    content.addView(TextView(this).apply {
      text = getString(R.string.nexus_microphone_reason)
      textSize = 16f
    })
    status = TextView(this).apply { tag = "nexus-microphone-status"; textSize = 16f }
    content.addView(status)
    request = Button(this).apply {
      tag = "nexus-microphone-request"
      text = getString(R.string.nexus_microphone_request)
      minHeight = (48 * resources.displayMetrics.density).toInt()
      setOnClickListener { askMicrophone() }
    }
    proceed = Button(this).apply {
      tag = "nexus-microphone-continue"
      text = getString(R.string.nexus_microphone_continue)
      minHeight = (48 * resources.displayMetrics.density).toInt()
      setOnClickListener { if (!pending) openMain() }
    }
    for (button in listOf(request, proceed)) content.addView(button,
      LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    setContentView(ScrollView(this).apply { isFillViewport = true; addView(content) })
    contentInsets = NexusWindowInsets(findViewById(android.R.id.content))
    updateControls()
  }

  override fun onResume() {
    super.onResume()
    // Another launcher instance or Settings may have completed the preflight meanwhile.
    if (!handedOff && (NexusLaunchState.mainEntered || hasMicrophone())) openMain()
  }
  private fun hasMicrophone() = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  private fun askMicrophone() {
    if (pending || handedOff || isFinishing || isDestroyed) return
    if (NexusLaunchState.mainEntered || hasMicrophone()) {
      openMain()
      return
    }
    pending = true
    updateControls()
    requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MICROPHONE_REQUEST)
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode != MICROPHONE_REQUEST || !pending || isFinishing || isDestroyed) return
    pending = false
    // Recheck actual OS authority; never trust a stale, empty or forged callback array.
    if (hasMicrophone()) openMain()
    else {
      denied = true
      updateControls()
    }
  }

  private fun updateControls() {
    request.isEnabled = !pending
    proceed.isEnabled = !pending
    status.text = when {
      pending -> getString(R.string.nexus_microphone_waiting)
      denied -> getString(R.string.nexus_microphone_denied)
      else -> ""
    }
  }

  private fun openMain() {
    if (handedOff || isFinishing || isDestroyed) return
    handedOff = true
    startActivity(Intent().setClassName(this, "$packageName.MainActivity")
      .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    finish()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    outState.putBoolean("nexus.microphone.pending", pending)
    outState.putBoolean("nexus.microphone.denied", denied)
    super.onSaveInstanceState(outState)
  }

  override fun onDestroy() {
    contentInsets?.close()
    contentInsets = null
    super.onDestroy()
  }

  companion object {
    internal const val MICROPHONE_REQUEST = 701
  }
}
