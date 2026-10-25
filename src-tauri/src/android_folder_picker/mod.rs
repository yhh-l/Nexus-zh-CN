//! Android's real app-scoped filesystem folder chooser, not a SAF URI-to-path guess.
//!
//! The Activity enumerates internal/external app directories and shows a native browser.
//! This adapter runs JNI on the Activity event loop, waits asynchronously, and rechecks
//! the canonical selected directory against those roots. Selecting only fills Settings'
//! draft; the existing verified-copy/write-pointer-last adoption path remains unchanged.
//! No storage permission, credential access, station startup, engine lock or RF call.
//! System-document import/export and external backups are separate, still required work.

mod policy;

use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;
use tauri::tao::platform::android::prelude::jni::objects::{JObjectArray, JValue};
use tauri::tao::platform::android::prelude::{jni, JObject, JString};
use tauri::Manager;
use tokio::sync::oneshot;

type Choice = Result<Option<String>, String>;
struct Pending {
    id: i64,
    roots: Vec<PathBuf>,
    result: oneshot::Sender<Choice>,
}
static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
static NEXT: AtomicI64 = AtomicI64::new(1);

fn pending() -> std::sync::MutexGuard<'static, Option<Pending>> {
    PENDING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Owns cancellation as well as completion. Never wait for Android while holding PENDING.
struct Ticket {
    id: i64,
    app: tauri::AppHandle,
}
impl Drop for Ticket {
    fn drop(&mut self) {
        {
            let mut slot = pending();
            if slot.as_ref().is_some_and(|item| item.id == self.id) {
                slot.take();
            }
        }
        let id = self.id;
        if let Some(window) = self.app.get_webview_window("main") {
            let _ = window.with_webview(move |webview| {
                webview.jni_handle().exec(move |env, activity, _| {
                    let result = env.call_method(
                        activity,
                        "cancelNexusDataFolder",
                        "(J)V",
                        &[JValue::Long(id)],
                    );
                    if result.is_err() && env.exception_check().unwrap_or(false) {
                        let _ = env.exception_clear();
                    }
                });
            });
        }
    }
}

fn begin(
    app: tauri::AppHandle,
    env: &mut jni::JNIEnv<'_>,
    activity: &JObject<'_>,
    initial: &str,
) -> Result<(Ticket, oneshot::Receiver<Choice>), String> {
    let array = env
        .call_method(
            activity,
            "nexusDataFolderRoots",
            "()[Ljava/lang/String;",
            &[],
        )
        .and_then(|value| value.l())
        .map_err(|e| e.to_string())?;
    let array = JObjectArray::from(array);
    let count = env.get_array_length(&array).map_err(|e| e.to_string())?;
    let mut roots = Vec::new();
    for index in 0..count {
        let path = env
            .get_object_array_element(&array, index)
            .map_err(|e| e.to_string())?;
        let path = JString::from(path);
        let path: String = env.get_string(&path).map_err(|e| e.to_string())?.into();
        let root = PathBuf::from(path)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !root.is_dir() {
            return Err("Android app storage root is not a directory".into());
        }
        roots.push(root);
    }
    if roots.is_empty() {
        return Err("Android supplied no accessible app storage roots".into());
    }
    let id = NEXT
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
        .map_err(|_| "Android folder request IDs exhausted")?;
    let (tx, rx) = oneshot::channel();
    {
        let mut slot = pending();
        if slot.is_some() {
            return Err("An Android data-folder chooser is already open".into());
        }
        *slot = Some(Pending {
            id,
            roots,
            result: tx,
        });
    }
    let ticket = Ticket { id, app };
    let initial = env.new_string(initial).map_err(|e| e.to_string())?;
    env.call_method(
        activity,
        "showNexusDataFolder",
        "(JLjava/lang/String;)V",
        &[JValue::Long(id), JValue::Object(initial.as_ref())],
    )
    .map_err(|e| e.to_string())?;
    Ok((ticket, rx))
}

pub(crate) async fn pick(app: tauri::AppHandle, initial: PathBuf) -> Choice {
    // The start oneshot carries ownership of the ticket, so a cancelled invocation also
    // cancels a dialog created concurrently on the UI thread, without retaining a waiter.
    let (tx, rx) = oneshot::channel();
    let ui_app = app.clone();
    let window = app
        .get_webview_window("main")
        .ok_or("Android main WebView is unavailable")?;
    // Tao's Rust event-loop thread is not necessarily the Java UI thread. Wry's
    // actual WebView JNI queue is the locked platform API that guarantees it.
    window
        .with_webview(move |webview| {
            webview.jni_handle().exec(move |env, activity, _| {
                let result = begin(ui_app, env, activity, &initial.to_string_lossy());
                if result.is_err() && env.exception_check().unwrap_or(false) {
                    let _ = env.exception_clear();
                }
                let _ = tx.send(result);
            });
        })
        .map_err(|e| format!("Cannot schedule Android folder chooser: {e}"))?;
    let (_ticket, answer) = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
        .await
        .map_err(|_| "Android folder chooser did not reach its UI thread")?
        .map_err(|_| "Android folder chooser did not start")??;
    answer
        .await
        .map_err(|_| "Android folder chooser ended without a result")?
}

/// MainActivity's native callback. No Java exception or panic is intentionally raised.
/// A stale/cancelled request cannot complete or remove a newer invocation.
#[no_mangle]
pub extern "system" fn Java_com_kd9taw_tempo_MainActivity_nexusDataFolderResult(
    mut env: jni::JNIEnv<'_>,
    _activity: JObject<'_>,
    id: jni::sys::jlong,
    path: JString<'_>,
    error: JString<'_>,
) {
    let item = {
        let mut slot = pending();
        if !slot.as_ref().is_some_and(|item| item.id == id) {
            return;
        }
        slot.take()
    };
    let Some(item) = item else { return };
    let result = (|| {
        if !error.is_null() {
            let error: String = env.get_string(&error).map_err(|e| e.to_string())?.into();
            return Err(error);
        }
        if path.is_null() {
            return Ok(None);
        }
        let path: String = env.get_string(&path).map_err(|e| e.to_string())?.into();
        let selected = policy::selected(&item.roots, std::path::Path::new(&path))?;
        Ok(Some(selected.to_string_lossy().into_owned()))
    })();
    if result.is_err() && env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
    }
    let _ = item.result.send(result);
}
