// Exercise the production startup URL logic without compiling the GUI/DSP stack.
// Tauri re-exports this same url::Url type. Native compilation remains a separate gate.
extern crate self as tauri;
pub use url::Url;

#[path = "../../../src-tauri/src/startup_navigation.rs"]
mod startup_navigation;
