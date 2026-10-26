# Android ARM64 internal test APK

This is an explicitly approved installer test, **not a public release or full
Android feature-parity claim**. The ordinary branch workflow still exports only
unsigned checkpoint reports. Signing is closed by default and only runs through
manual `workflow_dispatch` with `test_apk: true` on `codex/android-arm64`.

Before the native signing job can start, all existing portable, phone UI and both
real-browser jobs must succeed. The full backend, original model, audited host
source, actual JVM inventory and unsigned APK checks remain mandatory. The signed
APK is then inspected again with the original payload, ARM64, 16-KiB, dependency,
manifest-exposure and exact-notice checks. Actual SDK `apksigner verify` must
confirm v2/v3 signatures and exactly one certificate. A real SDK fixture is signed
in CI and deliberately corrupted to prove verification rejects changed bytes.
No check becomes optional and no unverified runtime/source-audit flag becomes true.

The version uses the current base plus `-android-test.<workflow-run-number>`;
it does not consume a public release version. The app identifier is unchanged.
Android 15/API 35 or newer and ARM64 are required. Samsung Galaxy S25 Ultra is the
first acceptance device; successful cryptographic checks are not installation or
physical-device acceptance.

## Key and artifact boundary

A fresh 3072-bit RSA test key is generated under the runner's temporary directory,
outside the checkout. Its random password is passed through child-process
environment variables, never command-line literals or logs. The private directory
and keystore use restrictive permissions and are removed on success or failure.
The private key is not committed, cached, uploaded or preserved as a secret.

Only four explicitly named files are uploaded: the signed test APK, public JSON
inspection report, SHA256SUMS and the test limitations/readme. Nothing under the
private temporary directory is an artifact path. Future keys will differ: back up
logbook/settings before installing, and expect an uninstall/reinstall if Android
refuses an update signed by a different test key. This is not a sustainable release
signing strategy; persistent release-key management requires separate approval.

## Acceptance still outstanding

The report keeps installation, S25 Ultra testing, full source/notice/security audit
and distributability unproven. Android station-side window streaming is still a
known unsupported platform feature. Audio, USB/CAT, decoding, logging, file access,
background/resume, panel lifecycle and always-available Stop need device evidence.
Do not use actual RF transmission as a first-start smoke test; TX remains OFF by
default and no transmit permissions, timing, sequencing or watchdog is changed.

Signing-setup-only commits may use the explicit `[manual-test-apk]` marker to
leave the ordinary unsigned native job unqueued. Their authoritative manual test
run still performs every full native check; this avoids building the same native
application twice ahead of the requested handoff. The successful manual run, not
a setup push with a skipped native job, is the handoff evidence.
