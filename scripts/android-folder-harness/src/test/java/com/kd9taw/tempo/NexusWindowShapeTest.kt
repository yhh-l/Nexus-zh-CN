package com.kd9taw.tempo

import android.app.Activity
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Compiles the product controller directly, with real modeled Android Views; no Tauri stub. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NexusWindowShapeTest {
  private fun layout(parent: FrameLayout, width: Int, height: Int) {
    parent.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
    parent.layout(0, 0, width, height)
  }

  private fun withViewport(block: (FrameLayout, WebView, NexusWindowShape) -> Unit) {
    val activity = Robolectric.buildActivity(Activity::class.java).setup()
    val view = WebView(activity.get())
    val originalDensity = view.resources.displayMetrics.density
    view.resources.displayMetrics.density = 1f
    val original = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT, Gravity.TOP or Gravity.START).apply {
      setMargins(3, 5, 7, 11)
    }
    activity.get().setContentView(view, original)
    val parent = view.parent as FrameLayout
    parent.setPadding(4, 6, 8, 10)
    val shape = NexusWindowShape(view)
    try {
      block(parent, view, shape)
    } finally {
      shape.close()
      view.resources.displayMetrics.density = originalDensity
      view.destroy()
      activity.pause().stop().destroy()
    }
  }

  @Test fun followsInsideRealContentParentWithoutReplacingOrCroppingTheWebView() = withViewport { parent, view, shape ->
    layout(parent, 1200, 1600)
    val originalPadding = listOf(view.paddingLeft, view.paddingTop, view.paddingRight, view.paddingBottom)
    val marker = Any()
    view.tag = marker
    assertTrue(shape.follow(1200, 800))
    val params = view.layoutParams as FrameLayout.LayoutParams
    assertEquals(1178, params.width)
    assertEquals(785, params.height)
    assertEquals(Gravity.CENTER, params.gravity)
    assertSame(parent, view.parent)
    assertSame(marker, view.tag)
    assertEquals(originalPadding, listOf(view.paddingLeft, view.paddingTop, view.paddingRight, view.paddingBottom))
  }

  @Test fun clampsExtremeRequestsToBoundedUsableViewports() = withViewport { parent, view, shape ->
    layout(parent, 1200, 1600)
    assertTrue(shape.follow(Int.MAX_VALUE, 1))
    var params = view.layoutParams as FrameLayout.LayoutParams
    assertEquals(1178, params.width)
    assertEquals(480, params.height)
    assertTrue(shape.follow(1, Int.MAX_VALUE))
    params = view.layoutParams as FrameLayout.LayoutParams
    assertEquals(320, params.width)
    assertEquals(1568, params.height)
    layout(parent, 300, 200)
    shape.resize()
    params = view.layoutParams as FrameLayout.LayoutParams
    assertEquals(278, params.width)
    assertEquals(168, params.height)
  }

  @Test fun followsParentConfigurationChangesAndRestoresExactOriginalLayout() = withViewport { parent, view, shape ->
    layout(parent, 1200, 1600)
    assertTrue(shape.follow(1200, 800))
    layout(parent, 700, 1000)
    shape.resize()
    val fitted = view.layoutParams as FrameLayout.LayoutParams
    assertEquals(678, fitted.width)
    assertEquals(480, fitted.height)
    shape.close()
    shape.close()
    val restored = view.layoutParams as FrameLayout.LayoutParams
    assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, restored.width)
    assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, restored.height)
    assertEquals(Gravity.TOP or Gravity.START, restored.gravity)
    assertEquals(listOf(3, 5, 7, 11), listOf(restored.leftMargin, restored.topMargin,
      restored.rightMargin, restored.bottomMargin))
    layout(parent, 1000, 700)
    assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, view.layoutParams.width)
    layout(parent, 0, 0)
    assertFalse(shape.follow(800, 600))
  }

  @Test fun refusesInvalidOrUnmeasuredRequestsWithoutChangingTheOriginalLayout() = withViewport { parent, view, shape ->
    layout(parent, 0, 0)
    assertFalse(shape.follow(800, 600))
    layout(parent, 1200, 1600)
    assertFalse(shape.follow(0, 600))
    assertFalse(shape.follow(800, -1))
    assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, view.layoutParams.width)
    assertTrue(shape.follow(800, 600))
    parent.removeView(view)
    shape.resize()
    shape.close()
    assertNull(view.parent)
  }
}
