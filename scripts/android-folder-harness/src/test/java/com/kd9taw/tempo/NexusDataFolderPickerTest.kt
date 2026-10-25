package com.kd9taw.tempo

import android.app.Activity
import android.app.AlertDialog
import android.widget.EditText
import android.widget.ListView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlertDialog
import java.io.File
import java.util.UUID

/** Framework-modeled native UI tests; these do not run Tauri, an APK or RF hardware. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NexusDataFolderPickerTest {
    @Test fun selectionPreservesActualExistingDataAndReturnsTheCanonicalFolder() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val directory = File(activity.filesDir, "picker-${UUID.randomUUID()}").apply { mkdirs() }
        val log = File(directory, "log.adi").apply { writeText("existing contacts") }
        var answer: String? = null
        var error: String? = null
        var calls = 0
        val picker = NexusDataFolderPicker(activity, directory.path) { path, failure ->
            calls++; answer = path; error = failure
        }
        try {
            picker.show()
            val dialog = ShadowAlertDialog.getLatestAlertDialog()
            val list = dialog.findViewById<ListView>(android.R.id.list)
            assertTrue(list.layoutParams.height > 0)
            picker.resize()
            assertTrue(list.layoutParams.height > 0)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick()
            picker.cancel()
            assertEquals(1, calls)
            assertEquals(directory.canonicalPath, answer)
            assertNull(error)
            assertEquals("existing contacts", log.readText())
        } finally {
            picker.cancel()
            controller.pause().stop().destroy()
            directory.deleteRecursively()
        }
    }

    @Test fun cancellationCompletesOnceWithoutSelectingOrAdoptingAnything() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        var calls = 0
        val picker = NexusDataFolderPicker(controller.get(), "content://not-a-local-directory") { path, error ->
            calls++; assertNull(path); assertNull(error)
        }
        try {
            picker.show()
            val dialog = ShadowAlertDialog.getLatestAlertDialog()
            assertFalse(dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled)
            dialog.cancel()
            picker.cancel()
            assertEquals(1, calls)
        } finally {
            picker.cancel()
            controller.pause().stop().destroy()
        }
    }

    @Test fun explicitNewFolderDoesNotOverwriteDataAndStillRequiresSelection() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val directory = File(activity.filesDir, "picker-${UUID.randomUUID()}").apply { mkdirs() }
        var answer: String? = null
        var calls = 0
        val picker = NexusDataFolderPicker(activity, directory.path) { path, error ->
            calls++; answer = path; assertNull(error)
        }
        try {
            picker.show()
            val parent = ShadowAlertDialog.getLatestAlertDialog()
            parent.getButton(AlertDialog.BUTTON_NEUTRAL).performClick()
            val prompt = ShadowAlertDialog.getLatestAlertDialog()
            val input = prompt.findViewById<EditText>(android.R.id.edit)
            input.setText("../escape")
            prompt.getButton(AlertDialog.BUTTON_POSITIVE).performClick()
            assertNotNull(input.error)
            assertEquals(0, calls)
            input.setText("new-data")
            prompt.getButton(AlertDialog.BUTTON_POSITIVE).performClick()
            val child = File(directory, "new-data")
            assertTrue(child.isDirectory)
            assertEquals(0, calls)
            parent.getButton(AlertDialog.BUTTON_POSITIVE).performClick()
            assertEquals(1, calls)
            assertEquals(child.canonicalPath, answer)
        } finally {
            picker.cancel()
            controller.pause().stop().destroy()
            directory.deleteRecursively()
        }
    }

    @Test fun lifecycleFailureDismissesTheDialogAndCannotCompleteAgain() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        var calls = 0
        val picker = NexusDataFolderPicker(controller.get(), controller.get().filesDir.path) { path, error ->
            calls++; assertNull(path); assertEquals("screen closed", error)
        }
        picker.show()
        val dialog = ShadowAlertDialog.getLatestAlertDialog()
        picker.fail("screen closed")
        picker.cancel()
        assertEquals(1, calls)
        assertFalse(dialog.isShowing)
        controller.pause().stop().destroy()
    }

    @Test fun containmentUsesDirectoryComponentsNotAStringPrefix() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val base = File(controller.get().filesDir, "picker-${UUID.randomUUID()}").apply { mkdirs() }
        try {
            val root = File(base, "app").apply { mkdirs() }
            val sibling = File(base, "app-other").apply { mkdirs() }
            assertTrue(NexusDataFolderPicker.contains(root, root))
            assertFalse(NexusDataFolderPicker.contains(root, sibling))
            assertFalse(NexusDataFolderPicker.contains(root, File(root, "../app-other")))
        } finally {
            controller.pause().stop().destroy()
            base.deleteRecursively()
        }
    }
}
