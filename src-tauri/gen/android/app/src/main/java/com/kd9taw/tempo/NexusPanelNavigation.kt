package com.kd9taw.tempo

import android.app.Activity
import android.content.Intent
import android.os.Looper

/** App-owned pages only: reorder the exact existing component, or finish that page alone.
 * No task-manager permissions, main-page reload, station calls or implicit external intent.
 */
internal object NexusPanelNavigation {
  fun show(activity: Activity) {
    check(Looper.myLooper() == Looper.getMainLooper())
    check(!activity.isFinishing && !activity.isDestroyed)
    activity.startActivity(Intent(activity, activity.javaClass).apply {
      addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    })
  }

  fun close(activity: Activity) {
    check(Looper.myLooper() == Looper.getMainLooper())
    activity.finish()
  }
}
