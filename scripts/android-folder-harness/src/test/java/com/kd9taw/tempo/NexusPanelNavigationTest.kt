package com.kd9taw.tempo

import android.app.Activity
import android.content.Intent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Tests the product navigation controller, not a fabricated TauriActivity or native engine. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NexusPanelNavigationTest {
  class Panel : Activity()

  @Test fun showTargetsOnlyTheExistingAppOwnedComponentWithoutANewTask() {
    val controller = Robolectric.buildActivity(Panel::class.java).setup()
    try {
      val page = controller.get()
      NexusPanelNavigation.show(page)
      val intent = shadowOf(page).nextStartedActivity
      assertEquals(Panel::class.java.name, intent.component!!.className)
      assertEquals(page.packageName, intent.component!!.packageName)
      assertEquals(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP, intent.flags)
      assertNull(intent.data)
      assertNull(intent.action)
      assertFalse(page.isFinishing)
    } finally { controller.pause().stop().destroy() }
  }

  @Test fun closeFinishesOnlyThePanelAndNeverTheMainActivity() {
    val main = Robolectric.buildActivity(Activity::class.java).setup()
    val panel = Robolectric.buildActivity(Panel::class.java).setup()
    try {
      NexusPanelNavigation.close(panel.get())
      assertTrue(panel.get().isFinishing)
      assertFalse(main.get().isFinishing)
      assertNull(shadowOf(main.get()).nextStartedActivity)
      assertNull(shadowOf(panel.get()).nextStartedActivity)
    } finally {
      panel.pause().stop().destroy()
      main.pause().stop().destroy()
    }
  }

  @Test fun finishingPageCannotStartAnotherActivity() {
    val controller = Robolectric.buildActivity(Panel::class.java).setup()
    try {
      controller.get().finish()
      assertThrows(IllegalStateException::class.java) { NexusPanelNavigation.show(controller.get()) }
      assertNull(shadowOf(controller.get()).nextStartedActivity)
    } finally { controller.pause().stop().destroy() }
  }

  @Test fun destroyedPageCannotStartAnotherActivity() {
    val controller = Robolectric.buildActivity(Panel::class.java).setup()
    val page = controller.get()
    controller.pause().stop().destroy()
    assertThrows(IllegalStateException::class.java) { NexusPanelNavigation.show(page) }
    assertNull(shadowOf(page).nextStartedActivity)
  }
}