package com.kd9taw.tempo

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Bundle
import android.os.Looper
import android.widget.Button
import com.kd9taw.tempo.Ft4222Descriptors.device
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowUsbManager

/** Actual product Activity and USB authority checks. Only the OS permission
 * request is recorded by a test shadow. No TauriActivity, USB I/O or RF executes.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [PreflightUsbManager::class])
class NexusUsbLaunchActivityTest {
  private lateinit var manager: UsbManager
  @Before fun coldProcess() {
    manager = RuntimeEnvironment.getApplication().getSystemService(Context.USB_SERVICE) as UsbManager
    NexusLaunchState::class.java.getDeclaredField("mainEntered").apply { isAccessible = true }.setBoolean(null, false)
    NexusUsbSelection::class.java.getDeclaredField("deviceName").apply { isAccessible = true }.set(null, null)
    PreflightUsbManager.request = null
    PreflightUsbManager.requests = 0
  }

  private fun attach(granted: Boolean = false, name: String = "/dev/bus/usb/001/002"): UsbDevice {
    val device = device(name = name)
    shadowOf(manager).addOrUpdateUsbDevice(device, granted)
    return device
  }
  private fun withPage(block: (NexusUsbLaunchActivity) -> Unit) {
    val owner = Robolectric.buildActivity(NexusUsbLaunchActivity::class.java).setup()
    try { block(owner.get()) } finally { owner.pause().stop().destroy() }
  }
  private fun button(page: NexusUsbLaunchActivity, tag: String): Button = page.window.decorView.findViewWithTag(tag)
  private fun choose(page: NexusUsbLaunchActivity, device: UsbDevice) {
    button(page, "nexus-usb-device-${device.deviceName}").performClick()
  }
  private fun reply(granted: Boolean) {
    // Intent extras are deliberately NOT trusted by the product, nor used to grant
    // anything in this framework model. An immutable PI may ignore these entirely.
    PreflightUsbManager.request!!.send(RuntimeEnvironment.getApplication(), 0,
      Intent().putExtra(UsbManager.EXTRA_PERMISSION_GRANTED, granted))
    shadowOf(Looper.getMainLooper()).idle()
  }
  private fun assertMain(page: NexusUsbLaunchActivity) {
    val intent = shadowOf(page).nextStartedActivity
    assertNotNull(intent)
    assertEquals(page.packageName + ".MainActivity", intent.component!!.className)
    assertEquals(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP, intent.flags)
    assertNull(intent.data)
    assertTrue(page.isFinishing)
    assertFalse(NexusLaunchState.mainEntered) // Only an Intent, not a substitute native host.
  }

  @Test fun noBridgeNeedsNoDialogOrPermissionRequest() = withPage { page ->
    assertMain(page)
    assertEquals(0, PreflightUsbManager.requests)
  }

  @Test fun coldMicrophoneHandoffRoutesConnectedBridgeToPrivateUsbPreflight() {
    attach()
    shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.RECORD_AUDIO)
    val owner = Robolectric.buildActivity(NexusLaunchActivity::class.java).setup()
    try {
      val page = owner.get()
      assertEquals(page.packageName + ".NexusUsbLaunchActivity", shadowOf(page).nextStartedActivity.component!!.className)
      assertEquals(0, PreflightUsbManager.requests)
      assertFalse(NexusLaunchState.mainEntered)
    } finally { owner.pause().stop().destroy() }
  }

  @Test fun forgedGrantCallbackCannotAuthorizeOrEnterTheStation() {
    val device = attach()
    withPage { page ->
      assertEquals(0, PreflightUsbManager.requests)
      assertNull(shadowOf(page).nextStartedActivity)
      choose(page, device)
      assertEquals(1, PreflightUsbManager.requests)
      val request = PreflightUsbManager.request!!
      assertTrue(request.isImmutable)
      assertEquals(page.packageName, shadowOf(request).savedIntent.`package`)
      assertFalse(button(page, "nexus-usb-continue").isEnabled)
      assertNull(shadowOf(page).nextStartedActivity)
      reply(true)
      assertFalse(manager.hasPermission(device))
      assertNull(NexusUsbSelection.deviceName)
      assertNull(shadowOf(page).nextStartedActivity)
      assertTrue(button(page, "nexus-usb-continue").isEnabled)
    }
  }

  @Test fun actualOsGrantSelectsOnlyTheRequestedBridgeThenEntersMain() {
    val device = attach()
    withPage { page ->
      choose(page, device)
      shadowOf(manager).addOrUpdateUsbDevice(device, true)
      reply(false) // A stale denial extra cannot override the actual OS authority either.
      assertEquals(device.deviceName, NexusUsbSelection.deviceName)
      assertMain(page)
    }
  }

  @Test fun deniedUserMayContinueWithoutChangingOsAuthority() {
    val device = attach()
    withPage { page ->
      choose(page, device)
      reply(false)
      button(page, "nexus-usb-continue").performClick()
      assertMain(page)
      assertFalse(manager.hasPermission(device))
      assertNull(NexusUsbSelection.deviceName)
    }
  }

  @Test fun multipleAlreadyGrantedBridgesStillRequireAnExplicitChoice() {
    attach(granted = true)
    val second = attach(granted = true, name = "/dev/bus/usb/001/003")
    assertEquals("NexusUsbLaunchActivity", NexusUsbLaunchActivity.destination(RuntimeEnvironment.getApplication()))
    withPage { page ->
      assertNull(shadowOf(page).nextStartedActivity)
      choose(page, second)
      assertEquals(second.deviceName, NexusUsbSelection.deviceName)
      assertEquals(0, PreflightUsbManager.requests)
      assertMain(page)
    }
  }

  @Test fun warmEntryNeverShowsUsbPermissionUiOverTheExistingHost() {
    attach()
    NexusLaunchState.enterMain()
    withPage { page ->
      val intent = shadowOf(page).nextStartedActivity
      assertEquals(page.packageName + ".MainActivity", intent.component!!.className)
      assertEquals(0, PreflightUsbManager.requests)
      assertEquals("MainActivity", NexusUsbLaunchActivity.destination(page))
    }
  }

  @Test fun rotationKeepsTheSameRequestAndAcceptsTheLateRealGrant() {
    val device = attach()
    val original = Robolectric.buildActivity(NexusUsbLaunchActivity::class.java).setup()
    choose(original.get(), device)
    val request = PreflightUsbManager.request
    val state = Bundle()
    original.saveInstanceState(state).pause().stop().destroy()
    val restored = Robolectric.buildActivity(NexusUsbLaunchActivity::class.java).create(state).start().resume().visible()
    try {
      assertEquals(1, PreflightUsbManager.requests)
      assertSame(request, PreflightUsbManager.request)
      assertFalse(button(restored.get(), "nexus-usb-continue").isEnabled)
      shadowOf(manager).addOrUpdateUsbDevice(device, true)
      reply(true)
      assertMain(restored.get())
    } finally { restored.pause().stop().destroy() }
  }

  @Test fun detachOrDialogFocusReturnCannotManufactureAPermission() {
    val device = attach()
    withPage { page ->
      choose(page, device)
      shadowOf(manager).removeUsbDevice(device)
      reply(true)
      assertNull(shadowOf(page).nextStartedActivity)
      assertNull(NexusUsbSelection.deviceName)
    }
    attach()
    withPage { page ->
      choose(page, device)
      page.onWindowFocusChanged(false)
      page.onWindowFocusChanged(true) // Handles denial arriving while the receiver was recreated.
      assertNull(shadowOf(page).nextStartedActivity)
      assertTrue(button(page, "nexus-usb-continue").isEnabled)
      assertNull(NexusUsbSelection.deviceName)
    }
  }
}

@Implements(UsbManager::class)
class PreflightUsbManager : ShadowUsbManager() {
  @Implementation fun requestPermission(device: UsbDevice, reply: PendingIntent) {
    request = reply
    requests++
  }
  companion object {
    var request: PendingIntent? = null
    var requests = 0
  }
}
