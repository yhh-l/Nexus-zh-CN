package com.kd9taw.tempo

import android.app.Activity
import android.graphics.Insets
import android.view.View
import android.view.WindowInsets
import android.webkit.WebView
import android.widget.FrameLayout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Product inset controller + real modeled Views; NOT a Tauri/phone/keyboard runtime test. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NexusWindowInsetsTest {
  private fun insets(left: Int = 0, top: Int = 24, right: Int = 0, bottom: Int = 48,
    keyboard: Int = 0, cutoutLeft: Int = 0): WindowInsets = WindowInsets.Builder()
      .setInsets(WindowInsets.Type.systemBars(), Insets.of(left, top, right, bottom))
      .setVisible(WindowInsets.Type.systemBars(), true)
      .setInsets(WindowInsets.Type.ime(), Insets.of(0, 0, 0, keyboard))
      .setVisible(WindowInsets.Type.ime(), keyboard > 0)
      .setInsets(WindowInsets.Type.displayCutout(), Insets.of(cutoutLeft, 0, 0, 0))
      .setVisible(WindowInsets.Type.displayCutout(), true)
      .build()

  private fun withContent(block: (FrameLayout, WebView, NexusWindowInsets, () -> Int) -> Unit) {
    val activity = Robolectric.buildActivity(Activity::class.java).setup()
    val view = WebView(activity.get())
    activity.get().setContentView(view)
    val content = view.parent as FrameLayout
    content.setPadding(2, 3, 5, 7)
    var calls = 0
    val owner = NexusWindowInsets(content) { calls++ }
    try { block(content, view, owner) { calls } }
    finally {
      owner.close()
      view.destroy()
      activity.pause().stop().destroy()
    }
  }

  private fun padding(view: View) = listOf(view.paddingLeft, view.paddingTop,
    view.paddingRight, view.paddingBottom)

  @Test fun systemBarsApplyToExistingContentWithoutChangingWebViewOrHistory() = withContent { content, view, _, _ ->
    val marker = Any()
    view.tag = marker
    val webPadding = padding(view)
    val result = content.dispatchApplyWindowInsets(insets())
    assertEquals(listOf(2, 27, 5, 55), padding(content))
    assertSame(content, view.parent)
    assertSame(marker, view.tag)
    assertEquals(webPadding, padding(view))
    assertTrue(result.isConsumed)
    assertNull(view.url)
  }

  @Test fun repeatedInsetsCannotAccumulatePaddingOrRepeatedShapeCallbacks() = withContent { content, _, _, calls ->
    content.dispatchApplyWindowInsets(insets())
    val afterFirst = calls()
    content.dispatchApplyWindowInsets(insets())
    assertEquals(listOf(2, 27, 5, 55), padding(content))
    assertEquals(afterFirst, calls())
    content.dispatchApplyWindowInsets(insets(left = 12, right = 18))
    assertEquals(listOf(14, 27, 23, 55), padding(content))
    assertEquals(afterFirst + 1, calls())
  }

  @Test fun keyboardOverlapsNavigationRatherThanAddingItsHeightTwice() = withContent { content, _, _, _ ->
    content.dispatchApplyWindowInsets(insets(keyboard = 300))
    assertEquals(listOf(2, 27, 5, 307), padding(content))
    content.dispatchApplyWindowInsets(insets())
    assertEquals(listOf(2, 27, 5, 55), padding(content))
  }

  @Test fun landscapeCutoutAndHiddenBarsRecomputeFromOriginalPadding() = withContent { content, _, _, _ ->
    content.dispatchApplyWindowInsets(insets(top = 0, right = 18, bottom = 24, cutoutLeft = 44))
    assertEquals(listOf(46, 3, 23, 31), padding(content))
    content.dispatchApplyWindowInsets(insets(top = 0, bottom = 0))
    assertEquals(listOf(2, 3, 5, 7), padding(content))
  }

  @Test fun closeRestoresOriginalAndRemovesListenerWithoutChangingTheWebView() = withContent { content, view, owner, calls ->
    content.dispatchApplyWindowInsets(insets(keyboard = 300))
    owner.close()
    owner.close()
    val count = calls()
    content.dispatchApplyWindowInsets(insets(left = 90, top = 90))
    assertEquals(listOf(2, 3, 5, 7), padding(content))
    assertEquals(count, calls())
    assertSame(content, view.parent)
  }
}
