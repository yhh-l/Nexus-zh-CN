//! Android MainShape adapter: the existing Activity resizes its real, still-mounted WebView.
//! Calls use Wry's Java UI queue and retain ordering of follow/restore. No desktop window
//! APIs, Activity task reordering, station calls or RF handling. Kotlin clamps the viewport
//! to the current content parent and restores its exact original LayoutParams on release.
//! Android stream capture is separate required work; this adapter does not claim to supply it.
use tauri::tao::platform::android::prelude::jni::objects::JValue;

pub(super) fn follow(window: &tauri::WebviewWindow, view: (u32, u32)) {
    let (Ok(width), Ok(height)) = (i32::try_from(view.0), i32::try_from(view.1)) else {
        eprintln!("[android-window] Viewport dimensions exceed Android's layout range");
        return;
    };
    if width <= 0 || height <= 0 {
        return;
    }
    schedule(window, Some((width, height)));
}

pub(super) fn restore(window: &tauri::WebviewWindow) {
    schedule(window, None);
}

fn schedule(window: &tauri::WebviewWindow, view: Option<(i32, i32)>) {
    let result = window.with_webview(move |webview| {
        webview.jni_handle().exec(move |env, activity, webview| {
            let result = match view {
                Some((width, height)) => env
                    .call_method(
                        activity,
                        "nexusFollowWindowShape",
                        "(Landroid/webkit/WebView;II)Z",
                        &[
                            JValue::Object(webview),
                            JValue::Int(width),
                            JValue::Int(height),
                        ],
                    )
                    .and_then(|value| value.z())
                    .map_err(|e| e.to_string())
                    .and_then(|accepted| {
                        if accepted {
                            Ok(())
                        } else {
                            Err("Android content viewport is not ready".to_string())
                        }
                    }),
                None => env
                    .call_method(
                        activity,
                        "nexusRestoreWindowShape",
                        "(Landroid/webkit/WebView;)V",
                        &[JValue::Object(webview)],
                    )
                    .map(|_| ())
                    .map_err(|e| e.to_string()),
            };
            if let Err(error) = result {
                if env.exception_check().unwrap_or(false) {
                    let _ = env.exception_clear();
                }
                eprintln!("[android-window] Cannot apply viewport layout: {error}");
            }
        });
    });
    if let Err(error) = result {
        eprintln!("[android-window] Cannot queue viewport layout: {error}");
    }
}
