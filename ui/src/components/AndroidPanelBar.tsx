// Native Android panel pages keep their full original renderer and the same station engine.
// This bar is shell chrome, outside all removable panes, and never changes the operating mode.
import { closePanelWindow, haltTx } from '../api'
import { t } from '../i18n'
import { useStationStopControl } from '../stationAccess'
import { withErrorToast } from '../toast'

export function androidPanelPage(): string | null {
  const query = new URLSearchParams(window.location.search)
  return query.get('androidPanel') === '1' ? query.get('panel') : null
}

export function AndroidPanelBar() {
  const panel = androidPanelPage()
  const mayStop = useStationStopControl()
  if (!panel) return null
  return (
    <div className="android-panel-bar android-panel-chrome">
      <button type="button" className="android-panel-back android-panel-action"
        onClick={() => void withErrorToast(() => closePanelWindow(panel), t('android.panel.closeFailed'))}>
        {t('android.panel.back')}
      </button>
      <button type="button" className="android-panel-stop android-panel-action android-panel-critical" disabled={!mayStop} title="Stop TX"
        onClick={() => { if (mayStop) void withErrorToast(() => haltTx(), t('shell.halt.failed')) }}>
        {/* Same safety token as CockpitTxStrip; no snapshot/pending-command dependency. */}
        Stop TX
      </button>
    </div>
  )
}