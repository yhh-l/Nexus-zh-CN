//! The OS login entry, shared by station and client mode.
//!
//! Desktop login is not Android boot or foreground-service permission. Register
//! the existing desktop plugin only where it exists. A mobile request fails
//! explicitly before either caller persists a preference; it never silently
//! starts the engine/radio at boot or pretends to have changed an OS setting.
//! Android lifecycle/background operation still needs its own implementation.

/// Attach the existing desktop plugin without changing any other shell plugin.
pub(crate) fn install<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_autostart::Builder::new().build());
    builder
}

/// Change the OS entry before the caller commits the corresponding preference.
pub(crate) fn set<R: tauri::Runtime>(app: &tauri::AppHandle<R>, on: bool) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        let launcher = app.autolaunch();
        let changed = if on {
            launcher.enable()
        } else {
            launcher.disable()
        };
        changed.map_err(|_| "launchAtLoginUnsupported".to_string())
    }
    #[cfg(mobile)]
    {
        let _ = (app, on);
        Err("launchAtLoginUnsupported".to_string())
    }
}
