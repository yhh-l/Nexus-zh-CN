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

## Historical local checkpoint (before the cloud-only policy)

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
  this checkpoint full CI coverage. No GitHub workflow had been dispatched at that checkpoint; see the cloud evidence below.
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
  GNU/Linux ARM64 binaries. The first cloud run built FFTW successfully but failed on a redundant interface-file copy before starting the runtime build; see the cloud evidence below.
- `scripts/android-native-link.mjs` will link the **whole** modem archive with unresolved
  symbols forbidden, inspect AArch64 ELF load segments for 16 KiB alignment, and refuse
  non-Android/unbundled C++ dynamic dependencies. This does not test APK ZIP alignment,
  Android loading, waveform parity or radio behavior.
- The branch-scoped workflow now has a second job for those real native builds, followed by
  `cargo check` of the full existing application backend with `--features radio,yaesu-wf`.
  Native binary distribution is intentionally deferred until the runtime NOTICE and
  complete-source audit is finished; the checkpoint uploads only its report and staged
  licence texts. There is still no APK build step or Android host project.

Historical local verification (before the cloud-only policy):

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
| UI | Existing viewport vocabulary, scroll ownership and dialog contracts; phone portrait/landscape/touch/keyboard tests | First bounded-navigation source change; pending cloud and device validation |
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

## Phone navigation implementation plan (2026-10-25)

Prefer a horizontally scrollable section strip over a radial navigation dial:
labels remain visible, a thumb can reach the next section without a precision
gesture, and existing desktop view identifiers/callbacks remain the contract.
A navigation swipe must never retune a radio, change a mode or transmit by itself;
only the existing explicit section-selection callbacks may do their current work.
Do not attach global swipe handlers across waterfalls, tuning controls or log forms.

- Reuse ModeNav's feature visibility, translated labels, selected-page semantics
  and saved section ordering; never create a second registry of views.
- Keep selection visibly in view, preserve keyboard/focus access, and distinguish
  scrolling the strip from activating a section. Do not require drag-reordering.
- Keep Settings reachable and current radio/frequency/connection status legible.
- Use existing effective viewport classes and sizing variables, not a separate
  raw-width media-query system. Preserve the desktop layout and zoom behavior.
- Keep the existing cockpit Stop controls outside removable panes and outside the
  navigation scroller. Navigation must not remount an active keyer or discard an
  unsaved QSO. Do not add TX operations to navigation effects.
- Account for system-bar safe areas, software keyboard, portrait/landscape and
  Android background/resume. Small-screen behavior is a new Android requirement,
  not evidence that today's desktop minimum window size already supports phones.

This plan guides the incremental source change described below; it is not device-tested behavior. Acceptance
requires rendered navigation/feature/keyboard tests, existing stop-control sweeps,
typecheck and the full UI suite in cloud CI, plus real layout checks and S25 Ultra
interaction checks. The cloud-only build policy applies to these tests too.
## First cloud evidence (2026-10-25, UTC+08)

- Exact pushed revision: `0386497e3f162b6c9a84a3348aac033a2cda8ac9`.
  The Android branch includes the official upstream `v1.20.0` release baseline;
  main was not changed and no release/tag was published.
- GitHub Actions run `40115059128`, workflow **Android ARM64 portability**.
  Portable-library job `120934522574`: **success**. Its real build report in the job log records 17 inspected AArch64 ELF objects per crate (51 total); this differs from the historical local incremental-build counts. Artifact `12568201806` exists (23,363,806 bytes), named `nexus-android-arm64-portable-libraries`; it is not an APK.
- Native job `120934675751`: **failure**. The downloaded job log proves the pinned
  host Flang 21.1.8 installed and FFTW compiled through the Android NDK API-35
  compiler. `make install` had already installed `prefix/include/fftw3.f03`.
  The bootstrap then tried to copy `api/fftw3.f03` from the SOURCE tree, where
  upstream has the template `fftw3.f03.in`; the generated file is in the separate
  BUILD tree. That redundant copy failed before Flang-RT was built.
- The source fix removes the nonexistent-source copy and checks the installed,
  nonempty interface instead. An executable validation-only regression checks
  missing, template-only, empty and installed interface fixtures. Neither the
  revised tests nor the revised native build have been run locally.
- No whole-modem link, full backend check, APK, Android runtime or device result
  is established by this first run. The failure is not a reason to disable modules.

## Phone navigation source change (pending cloud validation)

The existing narrow horizontal navigation now has a single bounded horizontal
scroller for sections, with Settings outside it. Section buttons retain intrinsic
width; narrow layouts disable drag-to-reorder so swipes remain ordinary scrolling.
The selected/focused section is revealed using zoom-correct horizontal movement
inside the strip only, including after a resize. Existing section identifiers,
feature visibility, persisted order and selection callbacks remain unchanged.
No tuning or transmit handler was added, and no cockpit Stop control was moved.

Rendered tests cover those behaviors and compute the real stylesheet cascade,
including desktop preservation and zero-sized first observations. Injected bounds
test scroll arithmetic, not real browser geometry. The Android workflow now also
includes the complete UI build/typecheck and full Vitest suite in an independent
cloud job. A cloud-only failing-first step runs the new navigation tests against the exact previous branch revision, requires the intended failures plus a passing desktop control, and restores the fixed sources before building/testing. These changes are not yet cloud-validated or phone-tested. Safe-area,
software-keyboard and actual S25 Ultra interaction checks remain open.

## Android host preparation (source only; pending approval/cloud validation)

`src-tauri/tauri.android.conf.json` is an Android-specific RFC 7396 overlay,
using the merge behavior in the locked Tauri utils 2.9.3 `config/parse.rs`.
Its window array REPLACES the desktop array: one visible `main`, no second
OS splash window and no inherited desktop minimum geometry in the config.
The initial API baseline remains 35. Desktop installer-updater artifacts are
not requested on Android; existing updater verification/service configuration
and the desktop configuration file are not changed.

The sole webview initially loads `android-start.html`, an original responsive,
script-free waiting page with safe-area padding and a reduced-motion style.
It does not invoke the engine or load the React app before `finish_launch`
attaches the logbook and navigates the existing main webview to the app. This
preserves the existing startup ordering rather than starting on `index.html`.
Runtime behavior and physical phone geometry have not yet been demonstrated.

The resource patch's `resources/hamlib/*: null` REMOVES that map key before
Tauri deserializes the merged config; it is not a literal null resource path.
All existing model/data/license mappings remain. Removing Windows Hamlib
resources does not implement Android Hamlib/CAT and is not permission to ship
without that functionality. Real Android device/CAT integration remains required.

`scripts/android-host-config.mjs` checks the actual source/config merge and
rejects desktop splash/minimum geometry, early engine UI, missing models or
licenses, declared foreign runtimes/sidecars and changed service/security
configuration. Its cloud report explicitly marks schema validation, generated
Android host, native compilation, payload inspection, APK and device checks
as FALSE. Source declarations cannot prove that the eventual APK payload is
Android-compatible; binary/ZIP/ABI checks are still required. Regression tests
cover both valid source configuration and counterexamples. The startup-page
UI tests render the actual HTML and compute its simple styles, but not geometry.

This does not yet add a generated Gradle/Kotlin project or an APK build job.
Desktop-only Rust plugin/window APIs, the runtime's 900x600 window-size call,
Android-private early data-directory initialization and lifecycle/device APIs
still need adaptation and real cloud compilation. No new third-party runtime,
credential handling or transmit operation is introduced by this preparation.

## Legacy FFTW ABI link failure and source repair (not yet cloud-validated)

Runs `40148958506` and `40149525151` got past the interface installation
failure and compiled the real modem, but the whole-modem link rejected five
undefined `sfftw_*` symbols from `four2a.f90`. The dependency bootstrap explicitly
passed `--disable-fortran`. In upstream FFTW 3.3.10, the legacy Fortran-callable
entry points are C wrappers; installing `fftw3.f03` does not supply them.

The pending repair selects `--enable-fortran`, retaining the NDK C compiler,
static single-precision library, PIC and NEON options. Any configure-time F77
mangling probes are not app/runtime objects. FFTW's real C wrapper implementations
must be compiled into the NDK archive; no handwritten symbol stubs, host archive
fallback or relaxed linker checks are introduced.

The bootstrap now inspects every archive member for AArch64 ELF64 and checks
NDK `llvm-nm` output for all five exact public definitions before building the
Flang runtime. The whole-modem link repeats the same check, keeps
`--no-undefined` and the Android dependency/16 KiB checks, and records the FFTW
ABI evidence in its successful report. An early failure lists missing entry
points explicitly instead of waiting until the final modem link.

Cloud-wired regression tests cover valid synthetic archive/symbol controls,
each missing definition, undefined/local/double-underscored substitutes, modern
C-only symbols and a foreign architecture. Synthetic fixtures are not binary
build or execution evidence. These new tests and the repaired dependency build
have not run locally or in GitHub Actions yet. Full backend, APK and S25 Ultra
runtime/RF acceptance remain unproven.

## Full-backend AI CW resource staging (source preparation)

The next workflow revision stages the same preprocessed DeepCW model and JSON
metadata already pinned by the desktop CI, from the existing upstream
`deepcw-model-v1` release. Both downloads must pass the existing SHA-256 pins,
and the tracked AGPL-3.0 license must be present before staging. This adds no
new model variant, dependency, license text, token or missing-model override.
The public release metadata was checked for matching file sizes/digests; the
binary has not been downloaded locally. Actual download/hash verification and
backend compilation belong to GitHub Actions and remain unproven for this edit.
The workflow source guard is not evidence that an APK contains the model or
that inference works; payload inspection and real runtime checks are still needed.

## Verified native checkpoint; next backend dependency repair

Run `40150753477`, head `17ae8d617`, passed the real whole-modem Android link.
Its uploaded report (artifact `12581769622`) records 618 AArch64 FFTW archive
objects, 189 modem archive objects, all five legacy FFTW definitions, four ELF
load segments with at least 16 KiB alignment, and only Android `libm.so`,
`libdl.so` and `libc.so` dependencies. The probe library is 18,786,696 bytes;
SHA-256 `e4a6ebbeae6a8a8de0bee74f6bbd8d435955c22caf5d7ff29c2af99f65cf645a`.
The full application check then failed because `openssl-sys 0.9.117` could not
find Android-target OpenSSL. This is a different blocker, not a modem regression.

The source repair builds upstream OpenSSL 3.5.9 for `android-arm64`, API 35,
static PIC, using the real NDK. The official release asset's SHA-256 is pinned
and checked before extraction and again by the evidence tool. No Ubuntu
`libssl-dev`, permissive cross-pkg-config fallback, TLS-backend switch, cipher,
certificate, credential or key change is used. Only Android-prefixed OpenSSL
Cargo discovery variables are exported, after successful target validation;
host build dependencies retain their own discovery environment.

The new check inspects every archive member, links the WHOLE `libssl.a` and
`libcrypto.a` with unresolved symbols forbidden, and checks actual resulting
ELF alignment/dependencies. Cloud artifacts contain only the evidence report
and upstream license, not a purported APK. The new build/tests have not run
locally or in Actions yet. The report keeps TLS handshake, Android trust-store,
full-app, APK and device-test claims false. OpenSSL's license and representative
compiled-source headers were reviewed; full redistribution/source inventory
and runtime trust-store acceptance still belong to the final APK audit.

The earlier full UI run exposed two test-harness errors: a Vite-rewritten
non-file `import.meta.url` when reading the startup HTML, and missing jsdom
`ResizeObserver` when Radix opens a keyboard-focused tooltip. The source fixes
use the existing UI-package-relative file-reading convention and a per-test
browser-API fixture, retaining the dedicated resize callback test and every
behavior/Stop assertion. A fast mobile/startup test step now precedes, but does
not replace, the complete UI suite. Run `40152455556` has now passed the
focused startup/mobile tests and the complete UI build; its full UI suite
is still running, so whole-suite success is not yet established.

## Cloud-only real-browser layout coverage (prepared, not yet executed)

The Android workflow now also wires the existing `ci.yml` compiled-Chrome
browser suite into two independent shards. It installs the locked UI/Remote
packages, builds the hosted UI and bundles the service with the existing
**dry-run** build command, then runs the unchanged complete browser suite.
Nothing is deployed and no live account or station is configured. The complete
jsdom suite, Stop sweeps and native checks remain separate and unchanged.
Passing and failing screenshots are retained as per-shard cloud artifacts so
actual boxes, clipping and hit targets can be inspected without another run.

This is shared-UI browser evidence only, not a replacement for the native
Android host. The suite uses its existing simulated issuer/station fixtures;
it does not prove Android WebView lifecycle, USB/audio, permissions, real
credentials, actual RF or S25 Ultra touch geometry. The new job has not run
yet, locally or in Actions. APK generation and physical acceptance remain
outstanding.

## Full-backend platform errors and first boundary repair

Run `40152455556` passed the whole native-modem link again, the actual AI CW
model downloads/digest checks, and the new NDK OpenSSL source build plus strict
whole-library link/alignment checks. The complete application then reached its
own Rust shell and failed with 40 diagnostics, many cascading from unavailable
desktop APIs. This is no longer the missing OpenSSL blocker. The full UI suite
is independently running; it is not evidence of a native backend or an APK.

The first source repair addresses two causes without removing an existing
Android business capability:

- The Remote/LAN embedded station windows were already explicitly Windows-only
  and returned `UNAVAILABLE` elsewhere. Their `if !cfg!(windows)` checks did not
  stop Rust from type-checking the unreachable Windows calls on Android. Actual
  conditional compilation now preserves the Windows implementation and the
  same non-Windows refusal. Routing, page isolation and navigation checks remain.
  This does **not** implement an Android Remote/LAN host or count it as complete.
- Station and client login entries use one platform adapter. Desktop keeps the
  actual plugin and enable/disable calls. Mobile does not register a nonexistent
  desktop plugin and returns the existing explicit unsupported error before
  preferences are written. There is no fake success, boot receiver or automatic
  radio start. Android background/lifecycle operation remains to be implemented.

Cloud-wired source guards carry refusal/negative controls; they do not execute
Android APIs. The cloud native job also checks standalone-shell formatting
before expensive compilation. These new changes have not been tested locally
or in Actions yet. Desktop regressions still require the complete normal CI.
Remaining known native errors include the data-folder picker and desktop
geometry/pinning/stream-shape calls. They are **not fixed by this first batch**;
no complete backend, installable APK or device acceptance is claimed.

## FT4222 final-link blocker and direct-USB wire work

The first full APK release native link (run 40166704243, job 121089258778)
failed because `-lftd2xx` and `-lft4222` are unavailable. Disabling `yaesu-wf`,
importing desktop binaries or bundling the closed FTDI libraries is not a fix.
The original `yaesu_wf::usb_protocol` module now encodes the measured FT-710
interface-A setup and bounded, packet-by-packet removal of FTDI status bytes.
It preserves 8192-byte SPI reads and does not change the frame/trailer parser.
Cloud tests cover full/high-speed packets, short-transfer boundaries, status
only, malformed/oversized data and failed transactions, not real USB hardware.

This module is NOT connected to `WaterfallSource` yet. The native Android USB
Host permission/endpoint/connection bridge, bounded concurrent read/write,
zero-length OUT chip-select release, cancellation and hardware acceptance
remain required. The existing driver is deliberately not stubbed out, so the
full APK link blocker remains until the genuine transport is integrated.

### Native Android USB Host connection source

`NexusFt4222Usb.kt` now implements an actual Android USB Host connection for
an already-granted FT4222. It selects interface A and valid bulk descriptors,
claims without force, clocks exactly 8192 dummy bytes concurrently with IN,
preserves each actual-length raw transfer, requires zero-length OUT CS release,
and closes on any I/O failure. One monotonic deadline bounds each transaction;
close can cancel a blocked read without waiting on the UI thread. It never
requests USB permission over the running station and claims no CAT/audio port.

The existing cloud native-controller harness now compiles this actual class
and tests it using Android descriptors plus a test-only hardware syscall shadow.
That is framework-modeled evidence, not a real host controller or FT-710.
USB permission UI, JNI factory registration, integration with WaterfallSource,
physical detach/reconnect/lifecycle/Stop checks and the full APK link remain
outstanding. The class does not resolve the FTDI final-link blocker on its own.

### Genuine USB WaterfallSource integration (cloud validation pending)

Android's `yaesu-wf` now selects the actual USB Host/JNI transport rather than
linking the desktop FTDI libraries. Desktop keeps its existing implementation.
The main WebView JNI queue captures only global class/application references;
USB opening, all controls and bulk reads run on the existing scope worker.
JNI arrays are length-bounded and local references released as they are read.
The real source executes all 18 setup requests, strips packet status bytes,
requires a complete 8192-byte transaction and uses the existing measured frame
trailer with the same three-frame accumulator limit. Partial setup closes the
connection. Exact release JNI names are retained by ProGuard.

Only a single actually OS-authorized FT4222 is accepted; none or multiple is a
real refusal, not an invented spectrum or first-device guess. The explicit
cold-start USB selection/permission UI remains required to make that grant
available to the application. This integration is not proof of a successful
APK link, hardware use or installability; read the actual cloud outcome.

### Cold-start USB grant and explicit bridge selection

The microphone preflight now routes an attached, ungranted or ambiguous FT4222
selection to a private native USB preflight before MainActivity. No bridge, a
single already-granted bridge or a warm station needs no new permission UI.
The permission request follows only a user device-button click, uses an
immutable package-scoped PendingIntent and a non-exported dynamic receiver,
and trusts neither callback permission bits nor callback device objects.
Selection rechecks the connected device and actual UsbManager authority.
Rotation preserves the request action/target without requesting again; focus
return and resume recheck missed grant/denial/detach outcomes. Selected bridge
routing is process-local and revalidated on every actual native open; multiple
already-granted bridges no longer force a first-device guess or a dead end.

Buttons live in an inset-aware native ScrollView with EN/zh strings. The real
Tauri host, decoder and transmit safety remain untouched. Changes to bridge
attachment/selection after station startup still require an app restart; no
runtime USB popup or automatic radio start is added. Cloud framework tests and
actual-source callback-authority mutation are not physical permission-dialog,
USB controller, lifecycle/Stop or FT-710 acceptance evidence. APK build and
S25 Ultra installation/runtime acceptance remain separate, unproven gates.

### Final binary Manifest component exposure gate

The actual produced APK is decoded using the installed Android SDK
`apkanalyzer manifest print`, with the command-line-tools revision metadata and
launcher hash recorded. The gate requires the sole native launcher, the private
main host and USB preflight, and all 17 private panels from the native routing
contract. Missing/duplicate names, unintended exports/aliases, unresolved export
values, private-page filters and unexpected launcher filters fail validation.
The sole reviewed exported maintenance exception is AndroidX's exact
ProfileInstallReceiver guarded by the platform DUMP permission; no generic
permission-bearing component exemption is accepted.

Cloud controls exercise both parser fixtures and real aapt2-compiled binary
Manifests. The negative control changes the actual fixture APK at the same path
and must be rejected after real SDK decoding. The fixture has no DEX or native
engine and is not install/runtime evidence. A source Manifest never substitutes
for the actual final APK. This is component-exposure evidence only, NOT a full
security audit, URI grant/provider-path review, permission-flow proof, signature,
installation, license/source-compliance or S25 Ultra acceptance. Those report
flags remain false until separately verified. Audit subprocesses have bounded
timeouts and missing decoder tools are a failure, not a silent skip.
### Explicit public Downloads export (runtime validation pending)

The existing text/PNG save commands now run off the UI thread. Desktop retains
its existing filesystem write. Android uses an original MediaStore transport to
create a new pending document in `Download/Nexus`, close its writer, read back
and compare every byte (including length), and only then publish the document.
The return value is the real `content://` URI, never a fabricated filesystem
path. Existing documents are not opened for overwrite; failures attempt to
remove the newly created pending row and never return success. Invalid names
and unknown content types fail before provider access. No storage-wide grant,
settings/credential change, automatic upload, permission modal or station/TX
operation is introduced. Private app-data roots remain unchanged.

The cloud framework harness compiles the actual Kotlin exporter and uses a
test-only MediaStore provider with real temporary file descriptors. It checks
text/PNG/multi-chunk/empty exports, collision preservation, corrupt/short/long
readback, create/write/read/publish refusal, name validation and UI-thread refusal.
A failing-first mutation removes actual readback and must trip the corruption
test before the original source and full suite are restored. This is not real
Android MediaStore/JNI/Downloads-app or S25 Ultra evidence. Genuine APK target
compilation and device export/reopen/uninstall-survival checks remain required.
SAF document selection/import and complete public backup workflows remain
separate missing work; this export does not claim to implement them.
### Existing system document import and provider read failures

The locked Wry 0.55.1 Android source already routes HTML file inputs through
its actual system file chooser and returns selected URIs to WebView. Nexus's
existing Logbook reads the resulting browser File and sends its text through
the original native ADIF/import, confirmation-sync or POTA-stamping route.
No content URI is converted into a guessed filesystem path. The three inputs
now deliberately have no accept filter: this avoids hiding documents based on
Android providers' MIME labels or reintroducing Linux's non-widenable MIME
filter. The File read itself is inside the existing error/toast
boundary. Unreadable/revoked documents are not submitted as empty logs; chooser
cancellation stays a no-op and the same file can be reselected for retry.

Cloud rendering tests exercise the actual three unfiltered Logbook inputs, controlled
browser File reads, the production error/toast boundary and original command
selection. A mutation restores extension-only filtering in the actual product
and must fail before the original source and full positive suite are restored.
The existing desktop no-MIME guard also runs unchanged. These tests do not launch Android DocumentsUI, test an external/cloud provider,
prove granted URI access, or establish Stop accessibility under a system picker.
Those device gates, complete public backup flows and actual end-to-end native
import evidence remain required. Earlier notes describing system import as
entirely unimplemented are superseded by this source finding, not by a physical
acceptance result.
### Android-target Rust notice preparation (not whole-APK compliance)

`scripts/android-rust-notices.py` derives the locked `aarch64-linux-android`
normal-edge graph for `radio,yaesu-wf,tauri/custom-protocol`. The last dependency
feature is added by the pinned Tauri CLI's actual mobile release build path.
It reuses the existing desktop notice generator's reviewed per-package text,
license-choice and pinned-source hash checks, but not its desktop target list.
Unknown graph entries, ambiguous package identities, missing Android JNI/root
provenance or unavailable reviewed license texts fail explicitly. Desktop-only
pins need not be used by this target subset; every used pin is still verified.

The focused GitHub workflow produces a scoped Rust notice text only when every
selected package is accounted for, and preserves an unresolved-findings report
on failure. Neither output is automatically inserted into an APK or described
as legal sign-off. Java/Kotlin dependencies, native FFTW/Flang/NDK/OpenSSL inputs,
model terms, corresponding-source delivery and comparison with the actual final
APK remain mandatory separate work. The report always leaves whole-runtime
notice/source compliance, APK payload verification and distributability false.
All graph resolution, text generation and tests run in GitHub Actions; local
work remains source editing and reading cloud evidence only.

### Android Rust missing-text follow-up

The first target notice run (40187645097) found nine missing license bodies.
Android-only reviewed pins now retain exact immutable sources, hashes and the
actual tao-macros Apache alternative. Desktop pins/elections remain unchanged.
See `licenses/rust/ANDROID-REVIEW.md`. New cloud tests cover collisions, real
Apache election, illegal alternatives, tampered hashes and VCS mismatches.
Generation, packaging, Java/AAR/native source coverage and physical validation
remain separate gates; source preparation alone proves none of them.

### Target Rust notices: delivery gate, not complete APK legal acceptance

Android build preparation generates the actual locked target graph before Tauri
resource preparation. `tauri.android.conf.json` replaces only the desktop Rust
notice source with `target/android-notices/RUST-THIRD-PARTY.txt` at the existing
`resources/rust/THIRD-PARTY.txt` destination; all other non-desktop resources stay.
The desktop generator, its notice file, and normal desktop Vite behavior remain.

The cloud APK builder explicitly selects `NEXUS_ANDROID_RUST_NOTICES=1` for its
existing complete frontend build. The real Vite emitter reads that exact generated
text only after validating source revision, target, features, completion, length
and SHA256. It never falls back to desktop text after Android selection. The
existing Settings > Licenses dialog and its relative asset path are unchanged.

`scripts/android-apk-notices.py` compares both the actual emitted frontend file
and the original final APK's `assets/resources/rust/THIRD-PARTY.txt` with the
validated target inventory. The mandatory native APK audit includes the result.
Its `--frontend-only` CLI records frontend emission only, never APK inspection.
Cloud controls reject stale/wrong-graph reports, substitutions, missing/duplicate
ZIP resources and changed generated texts. A focused workflow builds the real
frontend; the expensive whole-application workflow is still required to prove
actual APK byte delivery. Source edits or fixture tests alone do not prove it.

This still does not establish Android runtime rendering, JVM/AAR/transitive-native
license/source completeness, corresponding-source delivery, signature, install,
physical-device functionality or redistribution eligibility. Those flags remain
false, and only reports/texts, not APK binaries, are exported by these workflows.

### Resolved Android JVM inputs (not final APK retention or legal sign-off)

`scripts/android-jvm-inventory.gradle` is original report-only Gradle 8.14.3 code.
After the full real APK build/audit, the same generated Android project resolves
its actual `:app:universalReleaseRuntimeClasspath`. The collector records component and
project identities, transitive edges and the actual selected artifact hashes.
No repository, dependency, application-build, signing or credential policy is changed.
POM hashes/license-name hints and available sources-archive hashes/license-named
entry hashes are collected for review. Names are NOT proof of grants, per-file
licensing, corresponding-source completeness or final shrinker/DEX retention.
Project-source audits and absent POM/source materials remain explicit findings.
Only JSON is exported, including on resolver failure when a report is available.

The separate `Android JVM runtime inventory controls` workflow downloads the
exact official distribution already pinned by the host, verifies its SHA256,
and executes real Gradle against original local Maven/project fixtures. It tests
transitive/module/project records, actual artifact hashes, POM/sources/missing
source evidence, refusal of a missing runtime artifact and refusal of that fixture
as an actual Android runtime. These controls neither build nor prove the app.
All execution stays in GitHub Actions; no Gradle/Java installation or test runs
are performed locally. The full application runner must still produce and pass
its actual inventory before that real runtime-input evidence can be claimed.
All full license, APK-payload, signing, installation and device flags stay false.

### FT4222 partial-open JNI ownership

`android_ft4222/ownership.rs` is the actual product's shared JNI boundary, not a
replacement transport. Before an `AndroidUsb` owner exists, packet-query or global
reference promotion failure explicitly attempts Java-session close, with the
original pending exception cleared first. Cleanup exceptions are cleared without
replacing the opening error. Successful promotion transfers the same global ref
to the existing `AndroidUsb`/`UsbWaterfall` owners and does not close early.
Every bridge worker call uses a bounded JNI local frame, so malformed read/early
error paths also release temporary local references on an already attached thread.
USB setup, packet parsing, queue timing, permission routing and CAT/PTT are unchanged.

The cloud-only `android-ft4222-jni-harness` imports the exact product ownership file
and invokes it on a real Java 17 JVM using JNI 0.21.1 (the Wry bridge's existing API).
Its original Java fixture counts close attempts and throws controlled exceptions.
Tests cover success, real packet-getter exception, injected promotion failure with
a pending Java exception, throwing cleanup, null session and a reused clean worker.
A mutation removes the actual failure-cleanup branch and must fail the named
resource regressions. This is real JNI/lifetime testing with a controlled Java
object, NOT Android USB device I/O, OOM recovery proof, physical disconnect testing,
Android runtime execution or a complete working-radio/device acceptance claim.
No production dependency, signature/key, permission or transmitter policy changes.

### Fast actual JVM input preflight

The full Android workflow also resolves the real configured
`universalReleaseRuntimeClasspath` before final APK code generation. Its existing
backend check sets `TAURI_ANDROID_PROJECT_PATH`, allowing the official tauri-build
helper to generate the actual plugin integration. CLI initialization alone does
not generate these plugin files; empty substitutes would omit runtime inputs and
are not permitted. The early Gradle step reuses this actual checked backend's
integration, without building an APK. The universal flavor comes from the tracked
Rust Gradle plugin; an unflavored
release configuration must not substitute for the actual APK variant. Nested
buildSrc initialization is ignored, but the top-level `:app` remains mandatory.
The fixture suite includes both boundaries and removes the actual nested-build
guard to reproduce the original failure. The same collector still runs after the
whole APK audit. A preflight JSON is configured-input evidence only, not final
DEX contents, legal approval, signing, installation or device verification.

The inventory task also waits for dependency-project artifact producers before
hashing their actual AAR/JAR bytes. Already-created fixtures alone cannot prove
that ordering. An original Gradle archive-producing fixture starts without its
output and requires the producer's actual bytes/hash; removing the real producer
dependency must fail. The task graph refuses any additional `:app` build task
before execution, so this preflight cannot silently start the application's
native compilation, APK assembly or signing. Library dependency artifacts may be
built on the GitHub runner; no such binaries are exported as this JSON report.

The direct backend check supplies the pinned CLI's complete non-secret Android
code-generation environment: project path, Wry package/library, unescaped package
and Kotlin output directory (created before Cargo). Setting only the project path
activates Tauri's Kotlin/proguard generation without its required package variable;
this reproduced a real build-script panic before Gradle could run. The values match
the tracked host identity and `tempo_lib`, not a substitute or empty plugin graph.
Source-wiring omission/wrong-value controls run in cloud CI; only the actual Android
backend and subsequent real Gradle/APK jobs prove generation and integration.

The inventory selects AGP 8.11.0's unprocessed `android-aar-or-jar` artifact view,
matching its runtime dependency tooling. Raw configuration build dependencies
cannot select among project-produced runtime classes, AAR metadata and resources.
Both the producer dependency and byte inventory use the same typed artifact view;
no repository, dependency version or application task is substituted. The original
plain Gradle fixture uses the explicit `jar` type and publishes competing runtime
and metadata variants; cloud controls require the actual runtime producer/hash,
then remove the real selection attribute and require the named regression to fail.
This fixture is not AGP/Android proof: the real plugin graph, final APK inventory,
license/source review and device acceptance remain required independently.

A lenient typed view may omit an incompatible project artifact without recording
an artifact-resolution failure. The collector therefore also requires bytes for
every non-root runtime project and preserves explicit missing-project findings.
The archive-producing control explicitly publishes JAR type: Gradle otherwise
infers ZIP from its original Zip task even when its filename ends in `.jar`.
An incompatible-type project control must fail rather than producing a partial
green inventory. No real dependency or app feature is removed to satisfy a fixture.

Pristine host-source inspection/export runs after official integration generation
but before the early Gradle inventory compiles helper projects. Its compiled-file
refusal is unchanged. Final APK preparation requires that same cloud revision's
nonempty source audit and rehashes every recorded original source path, rejecting
changed bytes, symlinks and paths outside the host. It does not rerun a pristine
source scan over Gradle's legitimate buildSrc `.class` outputs. This ordering is
not final payload approval: the full APK binary audit remains mandatory afterward.
