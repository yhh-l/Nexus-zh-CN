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
# Generate only missing official integration files; never overwrite reviewed host source.
(cd src-tauri && cargo tauri android init --ci --skip-targets-install)
git diff --exit-code -- src-tauri/gen/android
printf '%s  %s\n' e996d452d2645e70c01c11143ca2d3742734a28da2bf61f25c82bdc288c9e637 src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar | sha256sum -c -
grep -Fx 'distributionSha256Sum=bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531' src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties
python3 scripts/android-host-source.py
# Release profile, with no signingConfig/keystore added: this is NOT an installable handoff.
# Both features stay on; neither missing-model nor missing-library overrides are used.
# Exact CLI source passes trailing args into the Cargo mobile builder, not Gradle options.
(cd src-tauri && cargo tauri android build --ci --target aarch64 --apk --features radio,yaesu-wf -- --locked)
git diff --exit-code -- Cargo.lock src-tauri/Cargo.lock src-tauri/gen/android
python3 scripts/android-apk-report.py