package com.kd9taw.tempo

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge

/** Real Tauri Activity pages, one component per existing renderer, sharing the native engine.
 * No alternate app, browser shell, restart of the main screen or fabricated TauriActivity.
 */
open class NexusPanelActivity : TauriActivity() {
  private var contentInsets: NexusWindowInsets? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    contentInsets = NexusWindowInsets(findViewById<View>(android.R.id.content))
  }

  override fun onDestroy() {
    contentInsets?.close()
    contentInsets = null
    super.onDestroy()
  }

  fun nexusShowPanel() = NexusPanelNavigation.show(this)
  fun nexusClosePanel() = NexusPanelNavigation.close(this)
}

class WaterfallPanelActivity : NexusPanelActivity()
class NeededPanelActivity : NexusPanelActivity()
class SpotsPanelActivity : NexusPanelActivity()
class MemoriesPanelActivity : NexusPanelActivity()
class ConnectPanelActivity : NexusPanelActivity()
class DxpedPanelActivity : NexusPanelActivity()
class PotaPanelActivity : NexusPanelActivity()
class SstvviewerPanelActivity : NexusPanelActivity()
class SatsPanelActivity : NexusPanelActivity()
class FielddayPanelActivity : NexusPanelActivity()
class ContestlogPanelActivity : NexusPanelActivity()
class ContestscreenPanelActivity : NexusPanelActivity()
class FdclubPanelActivity : NexusPanelActivity()
class OperatePanelActivity : NexusPanelActivity()
class OperatemapPanelActivity : NexusPanelActivity()
class BandmapPhonePanelActivity : NexusPanelActivity()
class BandmapCwPanelActivity : NexusPanelActivity()
