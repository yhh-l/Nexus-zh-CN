//! Existing complete panel renderers in app-private Android Activity pages, not external
//! browser windows. The main WebView stays alive with its drafts. Stable panel labels retain
//! chain identity, Tauri IPC/ACL and the same native engine. No remote URL or new permission.
mod policy;

use crate::chains::{self, Instance};
use tauri::utils::config::WindowConfig;

pub(crate) fn build(
    app: &tauri::AppHandle,
    slug: &str,
    instance: Instance,
    label: &str,
    title: String,
) -> Result<tauri::WebviewWindow, String> {
    chains::openable(instance)?;
    let component = policy::activity(slug).ok_or("Unknown Android panel")?;
    let config = WindowConfig {
        label: label.to_string(),
        title,
        url: tauri::WebviewUrl::App(format!("index.html?panel={slug}&androidPanel=1").into()),
        activity_name: Some(component),
        created_by_activity_name: Some("com.kd9taw.tempo.MainActivity".to_string()),
        drag_drop_enabled: false,
        ..Default::default()
    };
    tauri::WebviewWindowBuilder::from_config(app, &config)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

pub(crate) async fn show(window: &tauri::WebviewWindow) -> Result<(), String> {
    command(window, "nexusShowPanel").await
}

pub(crate) async fn close(window: &tauri::WebviewWindow) -> Result<(), String> {
    command(window, "nexusClosePanel").await
}

async fn command(window: &tauri::WebviewWindow, method: &'static str) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| {
            webview.jni_handle().exec(move |env, activity, _view| {
                if tx.is_closed() {
                    return;
                }
                let result = env
                    .call_method(activity, method, "()V", &[])
                    .map(|_| ())
                    .map_err(|e| e.to_string());
                if result.is_err() && env.exception_check().unwrap_or(false) {
                    let _ = env.exception_clear();
                }
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("Cannot queue Android panel navigation: {e}"))?;
    tokio::time::timeout(std::time::Duration::from_secs(10), rx)
        .await
        .map_err(|_| "Android panel navigation did not reach its UI thread".to_string())?
        .map_err(|_| "Android panel navigation ended without a result".to_string())?
}
