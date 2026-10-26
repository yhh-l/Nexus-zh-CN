#!/usr/bin/env bash
# Final native release code generation + REAL unsigned Gradle APK on the GitHub runner.
# No signing setup, keystore/secret access, install, publish or binary upload is authorized here.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'Cloud-only APK build' >&2; exit 2; }
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
: "${ANDROID_NDK_HOME:?Build the actual target dependencies first}"
: "${NEXUS_ANDROID_PREFIX:?Build the actual target dependencies first}"
: "${NEXUS_ANDROID_FLANG:?Use the verified Flang toolchain}"
: "${JAVA_HOME:?Use the runner Java 17}"
test -s src-tauri/resources/deepcw/model.onnx
printf '%s  %s\n' a7b3b4aa2610d3e88b8c7d4420eceee31be2d0ae595b3413264334f3ffb1eab5 src-tauri/resources/deepcw/model.onnx | sha256sum -c -
test "$(cargo tauri --version)" = 'tauri-cli 2.11.5'
# Generate the exact target notices on this same runner; never package desktop Rust notices.
python3 scripts/android-rust-notices.py
# Generate only missing official integration files; never overwrite reviewed host source.
(cd src-tauri && cargo tauri android init --ci --skip-targets-install)
git diff --exit-code -- src-tauri/gen/android
printf '%s  %s\n' e996d452d2645e70c01c11143ca2d3742734a28da2bf61f25c82bdc288c9e637 src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar | sha256sum -c -
grep -Fx 'distributionSha256Sum=bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531' src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties
# The mandatory workflow source audit runs before early Gradle inventory, which
# legitimately compiles buildSrc. Do not weaken its compiled-payload refusal or
# scan that now-built project as a pristine source tree. Recheck the exact audited
# source bytes/revision here; final APK payload inspection is still mandatory.
python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path
report = json.loads(Path('target/android-host-source/report.json').read_text())
if report['sourceCommit'] != os.environ['GITHUB_SHA'] or not report['hostSourceGenerated']:
    raise SystemExit('Current cloud source audit required before APK build')
project = Path('src-tauri/gen/android').resolve()
for name, digest in report['sourceHashes'].items():
    source = project / name
    if not source.resolve().is_relative_to(project) or source.is_symlink():
        raise SystemExit('Invalid audited host source path')
    if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
        raise SystemExit(f'Audited host source changed before APK build: {name}')
if not report['sourceHashes']:
    raise SystemExit('Empty host source audit refused')
print('Exact pre-Gradle audited host source revision and bytes preserved')
PY
# Release profile, with no signingConfig/keystore added: this is NOT an installable handoff.
# Both features stay on; neither missing-model nor missing-library overrides are used.
# The final Rust cdylib, not only the separate modem probe, must support 16 KiB
# Android pages. NDK r27's compiler driver must not choose the ELF layout implicitly.
# Tauri CLI 2.11.5 configure_cargo overwrites target-specific RUSTFLAGS. Use
# process-scoped generic flags, preserving ALL three defaults from its locked
# cargo-mobile2 0.22.4 src/android/target.rs, plus the final-link layout requirement.
# Never replace flags supplied by the caller without review; no desktop build is changed.
[[ -z "${RUSTFLAGS:-}" && -z "${CARGO_ENCODED_RUSTFLAGS:-}" ]] || {
  echo 'Unreviewed generic Rust flags override the Android 16 KiB link contract' >&2; exit 1;
}
android_rustflags='-Clink-arg=-landroid -Clink-arg=-llog -Clink-arg=-lOpenSLES -Clink-arg=-Wl,-z,max-page-size=16384'
# Only the separately approved manual test route gets a prerelease version overlay.
# This script still never handles signing keys or uploads any APK.
test_config_args=()
if [[ "${NEXUS_ANDROID_TEST_APK:-false}" == true ]]; then
  python3 scripts/android-test-apk.py --prepare-version
  test_config_args=(--config "$RUNNER_TEMP/nexus-android-test-version.json")
fi
# Exact CLI source passes trailing args into the Cargo mobile builder, not Gradle options.
(cd src-tauri && NEXUS_ANDROID_RUST_NOTICES=1 RUSTFLAGS="$android_rustflags" cargo tauri android build --ci --target aarch64 --apk --features radio,yaesu-wf "${test_config_args[@]}" -- --locked)
git diff --exit-code -- Cargo.lock src-tauri/Cargo.lock src-tauri/gen/android
python3 scripts/android-apk-report.py
python3 scripts/android-apk-audit.py

# Inspect the exact configured release JVM inputs after the real APK has been built.
# This resolves metadata/sources for review; it never declares full license acceptance.
(cd src-tauri/gen/android && ./gradlew --no-daemon --console=plain --max-workers=2 \
  --init-script ../../../scripts/android-jvm-inventory.gradle :app:nexusAndroidRuntimeInventory \
  -PnexusInventoryMode=android -PnexusInventoryReport=../../../target/android-jvm/runtime-inventory.json)
