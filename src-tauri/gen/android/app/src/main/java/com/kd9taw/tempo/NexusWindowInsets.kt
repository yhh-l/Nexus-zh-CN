package com.kd9taw.tempo

import android.os.Looper
import android.view.View
import android.view.WindowInsets

/** Keep the REAL WebView content clear of Android bars, cutouts and the keyboard.
 * Owns padding of the Activity content parent, never the WebView or its focus/history.
 * Combined inset types use their maximum, not a sum (IME already overlaps navigation).
 * Children receive consumed insets so WebView CSS cannot apply the same safe area twice.
 * No permission request, native dialog, engine, audio, CAT, TX or task manipulation.
 */
internal class NexusWindowInsets(private val content: View, private val changed: () -> Unit = {}) {
  private val original = intArrayOf(content.paddingLeft, content.paddingTop,
    content.paddingRight, content.paddingBottom)
  private var closed = false

  init {
    checkUi()
    content.setOnApplyWindowInsetsListener { _, insets -> apply(insets) }
    content.requestApplyInsets()
  }

  private fun apply(insets: WindowInsets): WindowInsets {
    checkUi()
    if (closed) return insets
    val safe = insets.getInsets(WindowInsets.Type.systemBars() or
      WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
    val left = original[0] + safe.left
    val top = original[1] + safe.top
    val right = original[2] + safe.right
    val bottom = original[3] + safe.bottom
    if (content.paddingLeft != left || content.paddingTop != top ||
      content.paddingRight != right || content.paddingBottom != bottom) {
      content.setPadding(left, top, right, bottom)
      changed()
    }
    return WindowInsets.CONSUMED
  }

  fun close() {
    checkUi()
    if (closed) return
    closed = true
    content.setOnApplyWindowInsetsListener(null)
    content.setPadding(original[0], original[1], original[2], original[3])
  }

  private fun checkUi() = check(Looper.myLooper() == Looper.getMainLooper())
}
