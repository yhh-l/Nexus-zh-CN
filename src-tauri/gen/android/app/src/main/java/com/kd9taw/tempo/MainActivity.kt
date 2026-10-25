package com.kd9taw.tempo

import android.content.res.Configuration
import android.os.Bundle
import android.os.Looper
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var folderPicker: NexusDataFolderPicker? = null
  private var folderRequest: Long? = null
  private var windowShape: NexusWindowShape? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  fun nexusDataFolderRoots(): Array<String> =
    NexusDataFolderPicker.roots(this).map { it.directory.path }.toTypedArray()

  fun showNexusDataFolder(requestId: Long, initial: String) {
    check(Looper.myLooper() == Looper.getMainLooper())
    check(folderPicker == null)
    folderRequest = requestId
    val picker = NexusDataFolderPicker(this, initial) { path, error ->
      if (folderRequest == requestId) {
        folderPicker = null
        folderRequest = null
      }
      nexusDataFolderResult(requestId, path, error)
    }
    folderPicker = picker
    picker.show()
  }

  fun cancelNexusDataFolder(requestId: Long) {
    check(Looper.myLooper() == Looper.getMainLooper())
    if (folderRequest == requestId) folderPicker?.cancel()
  }

  fun nexusFollowWindowShape(view: WebView, width: Int, height: Int): Boolean {
    check(Looper.myLooper() == Looper.getMainLooper())
    if (windowShape?.view !== view) {
      windowShape?.close()
      windowShape = NexusWindowShape(view)
    }
    return windowShape!!.follow(width, height)
  }

  fun nexusRestoreWindowShape(view: WebView) {
    check(Looper.myLooper() == Looper.getMainLooper())
    if (windowShape?.view === view) {
      windowShape?.close()
      windowShape = null
    }
    view.requestLayout()
  }

  private external fun nexusDataFolderResult(requestId: Long, path: String?, error: String?)

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    folderPicker?.resize()
    windowShape?.resize()
  }

  override fun onDestroy() {
    folderPicker?.fail(getString(R.string.nexus_folder_activity_closed))
    windowShape?.close()
    windowShape = null
    super.onDestroy()
  }
}
