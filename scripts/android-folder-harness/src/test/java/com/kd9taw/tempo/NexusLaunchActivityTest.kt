package com.kd9taw.tempo

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Executes the actual native preflight. Starting Main is inspected as an Intent;
 * no fake TauriActivity, native engine or RF is constructed by these modeled tests.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NexusLaunchActivityTest {
  @Before fun coldProcessWithoutPermission() {
    // Test-only isolation of a process-local one-way latch; no production reset API.
    NexusLaunchState::class.java.getDeclaredField("mainEntered").apply { isAccessible = true }.setBoolean(null, false)
    shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.RECORD_AUDIO)
  }

  private fun withPage(block: (NexusLaunchActivity) -> Unit) {
    val owner = Robolectric.buildActivity(NexusLaunchActivity::class.java).setup()
    try { block(owner.get()) }
    finally { owner.pause().stop().destroy() }
  }

  private fun button(page: NexusLaunchActivity, name: String): Button =
    page.window.decorView.findViewWithTag("nexus-microphone-$name")

  private fun assertMain(page: NexusLaunchActivity) {
    val intent = shadowOf(page).nextStartedActivity
    assertNotNull(intent)
    assertEquals(page.packageName + ".MainActivity", intent.component!!.className)
    assertEquals(page.packageName, intent.component!!.packageName)
    assertEquals(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP, intent.flags)
    assertNull(intent.action)
    assertNull(intent.data)
    assertTrue(page.isFinishing)
  }

  @Test fun coldLaunchWaitsForAnExplicitPermissionGestureBeforeStartingTheHost() = withPage { page ->
    assertNull(shadowOf(page).nextStartedActivity)
    assertNull(shadowOf(page).lastRequestedPermission)
    assertTrue(button(page, "request").isEnabled)
    assertTrue(button(page, "continue").isEnabled)
    assertFalse(NexusLaunchState.mainEntered)
    button(page, "request").performClick()
    val request = shadowOf(page).lastRequestedPermission
    assertNotNull(request)
    assertArrayEquals(arrayOf(Manifest.permission.RECORD_AUDIO), request.requestedPermissions)
    assertEquals(NexusLaunchActivity.MICROPHONE_REQUEST, request.requestCode)
    assertFalse(button(page, "request").isEnabled)
    assertFalse(button(page, "continue").isEnabled)
    assertNull(shadowOf(page).nextStartedActivity)
  }

  @Test fun deniedOrForgedCallbackDoesNotGrantPermissionOrStartTauri() = withPage { page ->
    button(page, "request").performClick()
    page.onRequestPermissionsResult(NexusLaunchActivity.MICROPHONE_REQUEST,
      arrayOf(Manifest.permission.RECORD_AUDIO), intArrayOf(PackageManager.PERMISSION_GRANTED))
    assertEquals(PackageManager.PERMISSION_DENIED, page.checkSelfPermission(Manifest.permission.RECORD_AUDIO))
    assertNull(shadowOf(page).nextStartedActivity)
    assertTrue(button(page, "request").isEnabled)
    assertTrue(button(page, "continue").isEnabled)
    assertFalse(NexusLaunchState.mainEntered)
  }

  @Test fun actualOsGrantHandsOffToExistingPrivateMainWithoutEnablingAnything() = withPage { page ->
    button(page, "request").performClick()
    shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.RECORD_AUDIO)
    page.onRequestPermissionsResult(NexusLaunchActivity.MICROPHONE_REQUEST,
      arrayOf(Manifest.permission.RECORD_AUDIO), intArrayOf(PackageManager.PERMISSION_GRANTED))
    assertMain(page)
    // Intent recorded only; proves no replacement/fake native host was executed by the test.
    assertFalse(NexusLaunchState.mainEntered)
  }

  @Test fun alreadyGrantedLaunchDoesNotShowOrRequestPermission() {
    shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.RECORD_AUDIO)
    withPage { page ->
      assertMain(page)
      assertNull(shadowOf(page).lastRequestedPermission)
    }
  }

  @Test fun warmHostIsReturnedToWithoutCoveringItsStopWithPermissionUi() {
    NexusLaunchState.enterMain()
    withPage { page ->
      assertMain(page)
      assertNull(shadowOf(page).lastRequestedPermission)
      assertEquals(PackageManager.PERMISSION_DENIED, page.checkSelfPermission(Manifest.permission.RECORD_AUDIO))
    }
  }

  @Test fun userCanDeclineWithoutChangingOsPermissionOrRemovingCaptureImplementation() = withPage { page ->
    button(page, "continue").performClick()
    assertMain(page)
    assertNull(shadowOf(page).lastRequestedPermission)
    assertEquals(PackageManager.PERMISSION_DENIED, page.checkSelfPermission(Manifest.permission.RECORD_AUDIO))
  }

  @Test fun rotationRetainsThePendingRequestRatherThanAskingTwice() {
    val original = Robolectric.buildActivity(NexusLaunchActivity::class.java).setup()
    button(original.get(), "request").performClick()
    val state = Bundle()
    original.saveInstanceState(state).pause().stop().destroy()
    val restored = Robolectric.buildActivity(NexusLaunchActivity::class.java).create(state).start().resume().visible()
    try {
      val page = restored.get()
      assertFalse(button(page, "request").isEnabled)
      assertFalse(button(page, "continue").isEnabled)
      assertNull(shadowOf(page).lastRequestedPermission)
      assertNull(shadowOf(page).nextStartedActivity)
      page.onRequestPermissionsResult(NexusLaunchActivity.MICROPHONE_REQUEST, emptyArray(), intArrayOf())
      assertTrue(button(page, "request").isEnabled)
      assertTrue(button(page, "continue").isEnabled)
      assertNull(shadowOf(page).nextStartedActivity)
    } finally { restored.pause().stop().destroy() }
  }
}
