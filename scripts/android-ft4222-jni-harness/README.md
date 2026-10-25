# Cloud-only FT4222 JNI ownership harness

This imports the SAME `src-tauri/src/android_ft4222/ownership.rs` used by the
Android bridge. The direct dependency is the bridge's existing JNI 0.21.1 API;
`invocation` is test-only so the GitHub runner's Java 17 JVM can be started.
The fixture is original Nexus test code; it does not impersonate Android USB.
No production dependencies/features, runtime libraries, permission, CAT/PTT or
signing configurations are changed. No JAR/class/native/APK binaries are uploaded.

The focused workflow runs five tests plus an actual removed-cleanup mutation
control and product-binding guards. Formatting is done/checked only in GitHub;
any exact formatting diff is retained for a separate formatting-only source commit.
Do not run this locally. No physical USB, Android lifecycle or phone compatibility
is established by this host JVM test.
