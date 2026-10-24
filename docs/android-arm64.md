# Nexus on Android ARM64 — engineering status

## Goal and non-goals

A native Android ARM64 port of the complete Nexus application, with Samsung Galaxy S25
Ultra as the first physical acceptance device. Reuse the existing Rust business logic and
React interface; adapt the interface to phone portrait/landscape and tablet-sized windows.
A remote-only web wrapper, a logbook-only rewrite, disabled-feature placeholders and a
successful build with missing native modules do **not** satisfy the goal.

This is development documentation, not an Android release announcement. There is currently
no installable APK from this work. Existing desktop verification remains mandatory.

## First milestone: real portable library cross-builds

`node scripts/android-arm64.mjs` builds these existing crates for
`aarch64-linux-android`, with the lockfile and each crate's default features unchanged:

| Crate | What this verifies | What it does not verify |
| --- | --- | --- |
| `tempo-base` | Shared application log, UTC calendar and shared protocol types compile | The QSO database, Android app storage or any permission to transmit |
| `propagation` | Statistics, award calculations, geography and propagation logic compile | The `live` feature, platform integrations or the complete logbook backend |
| `js8` | Existing pure-Rust JS8 PHY/protocol code compiles | Audio device I/O, CAT, timing performance or on-air interoperability on Android |

The script reads Cargo's actual artifact messages, requires all three libraries, and
checks their ar members for ELF64 little-endian AArch64 relocatable objects. Wrong-host
artifacts, metadata-only archives, mixed foreign objects and missing packages fail.
ELF machine type alone does **not** distinguish Android from GNU/Linux; provenance here
comes from the explicit Cargo target and building the existing source. This guard is not
an approval mechanism for copying prebuilt Linux libraries into an APK.

A successful run writes `target/android-arm64/build-report.json` with artifact sizes,
SHA-256 hashes, inspected object counts, and explicit `false` values for full-application,
APK and physical-device verification. A failed rerun removes the old success report.
The `.rlib` files are intermediate Rust libraries, not independently installable apps or
Android JNI libraries. The SDK/NDK and app linker are not exercised by this milestone.

### Execution policy (2026-10-25)

All further compilation and tests run on GitHub Actions at the user's request.
Local work is limited to source edits, lightweight Git operations and cloud-log
inspection. Do not install a local SDK/JDK or run these build/test commands locally.
Earlier local portable-library results are historical checkpoints, not a cloud pass.
The workflow pins Rust 1.93.1 and records coverage explicitly.
### GitHub Actions

`.github/workflows/android-arm64.yml` runs only on an approved push to
`codex/android-arm64` or a manual dispatch, has read-only repository
permissions, requires no signing secret, and does not publish a release. After a separately
approved push, **Android ARM64 portability** starts on that branch. It does not
trigger on main or unrelated branches. Manual dispatch is also declared.
A successful run uploads **nexus-android-arm64-portable-libraries**, including the coverage
report and three `.rlib` files. It deliberately does not promise an APK.

The archive/artifact regression tests also run in `.github/workflows/ci.yml`, so the normal
`scripts/gates` discovery includes them. The Android cross-build is a separate, explicitly
branch-scoped milestone, not evidence that every desktop or Android gate passed.

## Verified local checkpoint (2026-10-25)

- Rust 1.93.1 cross-built all three default-feature libraries for
  `aarch64-linux-android`. Inspected ELF object counts: `tempo-base` 137,
  `propagation` 257, `js8` 247 (641 total). Actual artifact hashes and sizes are in
  the generated report, not inferred from the `.rlib` filenames.
- Android guard tests: 27 passed. Together with the existing release-secrets tests:
  53 passed. The existing gate reader parsed both workflows successfully.
- Full desktop gates did **not** pass locally: the Windows process could not start
  `bash` (22 attempted gates failed to launch; 56 skipped). The existing
  `gates.test.mjs` also cannot spawn the extensionless script on this Windows setup;
  the same 35 failures reproduced in the untouched original checkout. Do not call
  this checkpoint full CI coverage. No GitHub workflow was dispatched.
- No APK, Android runtime, audio hardware, physical phone or RF behavior was tested.

## Native-backend milestone in progress (2026-10-25)

Implemented, but **not yet proven by an Android native build**:

- `tempo-fast-sys` now dispatches Android targets to `android_build.rs` before any
  desktop CMake/pkg-config path. It requires a real NDK and Android-built FFTW/Flang
  archives, checks every archive for foreign architecture objects, and never substitutes
  an empty modem or a desktop library. Existing Fortran/DSP sources are unchanged.
- `libtempo/android-arm64.cmake` selects NDK C/C++, LLVM Flang, PIC and the Android
  static C++ runtime. GNU-only compiler flags remain on the desktop branch.
- Initial native baseline: **Android 15 / API 35**, ABI `arm64-v8a`, for S25 Ultra.
  This is a build target, not proof of device compatibility or support for older phones.
- `scripts/install-android-flang.sh` prepares the host frontend on an ephemeral Ubuntu
  runner. `scripts/build-android-native.sh` verifies pinned upstream inputs and builds
  FFTW 3.3.10 and the LLVM 21.1.8 Fortran runtime against the NDK, rather than importing
  GNU/Linux ARM64 binaries. These Linux bootstrap builds have not run yet.
- `scripts/android-native-link.mjs` will link the **whole** modem archive with unresolved
  symbols forbidden, inspect AArch64 ELF load segments for 16 KiB alignment, and refuse
  non-Android/unbundled C++ dynamic dependencies. This does not test APK ZIP alignment,
  Android loading, waveform parity or radio behavior.
- The branch-scoped workflow now has a second job for those real native builds, followed by
  `cargo check` of the full existing application backend with `--features radio,yaesu-wf`.
  Native binary distribution is intentionally deferred until the runtime NOTICE and
  complete-source audit is finished; the checkpoint uploads only its report and staged
  licence texts. There is still no APK build step or Android host project.

Verified locally in this checkpoint:

- **66 Node script/integration tests passed** (including the prior archive/release guards).
  The native test harness also compiles and executes **8 Rust archive/target tests**.
- The real Cargo build script was executed under Android target environment variables:
  absent NDK, wrong target and foreign archive cases all refused before host fallback.
  CMake toolchain configuration checks passed; they did not compile Android code.
- Both new Linux shell scripts passed `bash -n`. Neither installed Linux packages on the
  Windows host. These syntax checks are not dependency build results.
- A real full-backend Android check was attempted and failed because the local machine
  has no NDK Clang (`aarch64-linux-android-clang` / `clang.exe` not found). Its log is
  `target/android-full-backend-check.txt`; do not describe it as a successful backend build.
- A targeted Windows desktop-native regression was also attempted and failed with the
  existing gfortran extended-path/source lookup problem. The same failure reproduced on
  an untouched `origin/main` managed worktree at the same base commit. Both logs are
  retained under `target/`; this is not a passing desktop native regression. The temporary
  baseline checkout could not be archived because the app requires sign-in; it was left
  intact, with no running build process.
- No branch push, GitHub workflow run, signed package, phone installation or RF test has
  been performed. The next cloud run requires specific approval for the branch push and its build.

Native build inputs, once the dependency bootstrap has actually succeeded:

| Variable | Meaning |
| --- | --- |
| `ANDROID_NDK_HOME` | Installed Android NDK, including API 35 target libraries |
| `NEXUS_ANDROID_FLANG` | LLVM 21.1.8 host frontend executable |
| `NEXUS_ANDROID_PREFIX` | Android-built `libfftw3f.a`, `libflang_rt.runtime.a`, FFTW and isolated Boost headers |

The workflow receives only these build paths and compiler paths; it does not copy an
operator's logs, certificates or complete environment into artifacts.

## Full-port acceptance matrix — no functionality silently dropped

| Subsystem | Required Android work / evidence | Current state |
| --- | --- | --- |
| Tauri host | Android project, mobile entry point, launch/restore, platform-specific plugins | Existing mobile entry annotation found; Android project and platform adaptation incomplete |
| Logbook | Existing ADIF parsing, preservation, backup, deduplication, CRUD and SQLite behavior on device | Not verified; `tempo-core` still depends on the modem graph |
| Statistics and awards | Existing calculations plus device-side results against the same desktop fixtures | Library cross-build covered; Android runtime not verified |
| Online services | Existing queries/uploads/confirmation downloads, separate per-service state, Android certificate/credential storage | Not implemented; do not change credential handling without approval |
| FT/Tempo DSP | Android-targeted Fortran/C/C++, FFTW and compatible runtime libraries, actual linkage, reference waveform/decode checks | Android dispatch and dependency/link pipeline implemented; actual native build and linkage not verified |
| JS8 | Existing algorithms, Android audio path and performance, waveform/decode reference checks | Library cross-build covered; device/RF behavior not verified |
| CW/SSTV/APRS | Existing codecs/decoder models and platform integrations | Not verified |
| CAT/USB/audio | Android device permission, real transport, sample routing, connect/disconnect and lifecycle handling | Not implemented |
| Transmit safety | Existing OFF-at-start latch, identity/licence gates, watchdog and always-reachable Stop; background/interruption tests | No changes made; Android behavior not verified |
| Maps/offline data | Existing map features and pack validation with Android storage | Not verified |
| Files | Android document picker, import/export/share, backup/restore without deleting source data | Not implemented |
| UI | Existing viewport vocabulary, scroll ownership and dialog contracts; phone portrait/landscape/touch/keyboard tests | Not changed |
| Localization | Preserve translated display strings while keeping ADIF/protocol IDs stable; reconcile the separately developed localization branch | Not integrated into this branch |
| Packaging | ARM64 APK, native-library loadability and alignment, update identity/signature, install/upgrade tests | Not implemented; signing-key changes require separate approval |

## Next critical path

1. Establish the library cross-build result and retain its explicit coverage report.
2. Execute and repair the new Android-compatible Fortran/FFTW/runtime bootstrap and pass real linkage
   of `tempo-fast-sys`; the current native branch must not accidentally run host compilers
   for an Android target. No modem stubs and no TX-sequencing changes to make it pass.
3. Add the Android application host and isolate desktop-only plugins without changing the
   desktop dependency/behavior contract. Adapt storage and platform services.
4. Port device I/O and mobile layouts, then run desktop regressions and physical S25 Ultra
   acceptance. Compilation is not proof of radio behavior; do not enable unattended RF tests.

Approval gates, contributor protocol and transmit invariants remain in `CLAUDE.md`; this
page records implementation status and does not replace or override those rules.
