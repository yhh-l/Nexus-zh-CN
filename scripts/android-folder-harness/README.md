# Cloud-only native folder and viewport test harness

This library harness compiles the **actual** `NexusDataFolderPicker.kt` and
`NexusWindowShape.kt` from the
product source directory, using the Android SDK and the same AGP/Kotlin/Material
versions as the real Android host. It does not copy the class, provide a fake
TauriActivity, replace the application or produce a candidate APK. The small
library manifest is test scaffolding, not an alternative app manifest.

JUnit 4.13.2 and Robolectric 4.14.1 (test-only, not shipped app dependencies)
exercise selection/cancellation, explicit directory creation, directory-boundary
checks and modeled dialog cleanup on API 35. These are Android-framework-modeled
host tests, **not** emulator/device execution, TauriActivity lifecycle validation,
JNI linking or real pixel/Stop hit testing. Those remain full-build/runtime gates.

The workflow bootstraps the exact upstream wrapper only on GitHub, checks the JAR
hash from the real pinned Tauri generator, and pins Gradle's official 8.14.3 ZIP
checksum in the committed wrapper properties. Do not run this locally.

The live database chooser uses internal or mounted external **app-specific**
filesystem directories, with a canonical containment recheck in Rust. It does
not reinterpret content URIs as paths or implement public-document import/export.
Those features remain required Android work, as do permanent Stop access while
native/platform dialogs are open and physical phone/tablet interaction checks.

The real viewport controller is also exercised with Android WebView/FrameLayout objects:
usable bounds (including parent padding/margins), extreme aspect ratios, layout changes,
exact original layout restoration, invalid requests and detached-view cleanup. It never
replaces/reloads the WebView. The stream's Android capture/encoding/input integration is
still required: viewport tests do not establish streaming support or persistent Stop access.
