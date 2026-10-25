package com.kd9taw.tempo

import android.os.Looper
import android.view.Gravity
import android.view.View
import android.webkit.WebView
import android.widget.FrameLayout
import kotlin.math.min
import kotlin.math.roundToInt

/** Resize the real, still-mounted Wry WebView, not the Activity or a cropped bitmap.
 * Wry 0.55.1 installs it with Activity.setContentView(View), whose content parent is a FrameLayout.
 * The Activity retains control of system bars, insets and lifecycle. No task, focus, TX or RF calls.
 * This is window layout support, NOT an implementation or validation of Android stream capture.
 */
internal class NexusWindowShape(val view: WebView) {
  private val parent = view.parent as? FrameLayout
    ?: error("Nexus WebView has no supported Android content parent")
  private val original = FrameLayout.LayoutParams(view.layoutParams as? FrameLayout.LayoutParams
    ?: error("Nexus WebView has no Android content layout"))
  private var requested: Pair<Int, Int>? = null
  private var listening = false
  private var closed = false
  private val resized = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> apply() }

  fun follow(width: Int, height: Int): Boolean {
    checkUi()
    if (closed || width <= 0 || height <= 0 || availableWidth() <= 0 || availableHeight() <= 0) return false
    requested = width to height
    if (!listening) {
      parent.addOnLayoutChangeListener(resized)
      listening = true
    }
    return apply()
  }

  fun resize() {
    checkUi()
    apply()
  }

  private fun availableWidth() = parent.width - parent.paddingLeft - parent.paddingRight -
    original.leftMargin - original.rightMargin
  private fun availableHeight() = parent.height - parent.paddingTop - parent.paddingBottom -
    original.topMargin - original.bottomMargin

  private fun apply(): Boolean {
    val target = requested ?: return false
    if (closed || view.parent !== parent) return false
    val width = availableWidth()
    val height = availableHeight()
    if (width <= 0 || height <= 0) return false
    val scale = min(width.toDouble() / target.first, height.toDouble() / target.second)
    val density = view.resources.displayMetrics.density
    // Like the desktop follow policy, respect usable cockpit floors instead of following an
    // extreme remote aspect into a one-pixel strip. Never exceed the actual OS content bounds.
    val minWidth = min(width, (320 * density).roundToInt().coerceAtLeast(1))
    val minHeight = min(height, (480 * density).roundToInt().coerceAtLeast(1))
    val fittedWidth = (target.first * scale).roundToInt().coerceIn(minWidth, width)
    val fittedHeight = (target.second * scale).roundToInt().coerceIn(minHeight, height)
    val params = FrameLayout.LayoutParams(original).apply {
      this.width = fittedWidth
      this.height = fittedHeight
      gravity = Gravity.CENTER
    }
    val current = view.layoutParams as? FrameLayout.LayoutParams
    if (current == null || current.width != params.width || current.height != params.height || current.gravity != params.gravity) {
      view.layoutParams = params
    }
    return true
  }

  fun close() {
    checkUi()
    if (closed) return
    closed = true
    requested = null
    if (listening) parent.removeOnLayoutChangeListener(resized)
    listening = false
    if (view.parent === parent) view.layoutParams = FrameLayout.LayoutParams(original)
  }

  private fun checkUi() = check(Looper.myLooper() == Looper.getMainLooper())
}
