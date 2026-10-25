# Native Android host source (not an APK)

This is the real Tauri CLI 2.11.5 Gradle/Kotlin host generated on GitHub Actions,
reviewed before import. It retains the existing `com.kd9taw.tempo` application
identity, Android 15/API 35 minimum and the actual TauriActivity/Rust integration.
The native backend, document I/O, window/stream adapters, audio and USB/CAT still
require Android build/runtime/device verification. This source is not a working
APK and is not permission to sign or publish one.

## Source and licensing

See `licenses/android-host/README.md` and `GENERATED-SOURCE.json` at the repository
root for the exact cloud source provenance, per-file header review and upstream
license texts. The Gradle wrapper scripts keep their Apache-2.0 headers.

Only 21 generated text files were imported. The template's 15 PNG icons, two
Android-robot vector drawables and unused Hello World layout were not imported.
The launcher instead references `res/drawable-nodpi/nexus_launcher.png`, an exact
copy of Nexus's existing `src-tauri/icons/icon-source.png`; no new artwork or
placeholder screen is substituted for the application. The actual UI is created
by TauriActivity and the existing Android startup page, not a layout placeholder.

## Cloud-only tools

`gradle-wrapper.jar`, `local.properties`, generated Tauri plugin bindings, native
libraries and build outputs are not tracked. A future build must bootstrap and
verify the exact wrapper on GitHub and let the real Tauri build generate its
plugin integration files. Do not create empty `tauri.settings.gradle` or
`tauri.build.gradle.kts` files to make standalone Gradle tasks appear to pass.
Do not run a local Gradle/Cargo/SDK build for this port.

The source-generation workflow may recreate unused template resources in its
throwaway GitHub checkout. It must not overwrite any reviewed tracked host file.
Only an explicitly selected ARM64 build can become the intended APK; the
upstream plugin's other desktop/emulator ABI variants are not acceptance evidence.
