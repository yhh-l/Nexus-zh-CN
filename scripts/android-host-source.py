#!/usr/bin/env python3
"""Review/export a real Tauri-generated Android host on GitHub, never an APK.

This validates generated source plus mutation controls against those actual files.
It neither generates replacement templates nor builds, signs, installs or publishes.
The Gradle wrapper JAR is build tooling, not source; record its hash but do not export
it for local execution. Its verified cloud bootstrap remains a separate build step.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT / "src-tauri/gen/android"
OUTPUT = ROOT / "target/android-host-source"


def require(ok, message):
    if not ok:
        raise ValueError(message)


def inherited_identity(base, patch):
    # RFC 7396: a missing platform member retains the base value; explicit null
    # is different from absence and cannot silently replace application identity.
    identifier = patch.get("identifier", base["identifier"])
    require(identifier == base["identifier"], "Android changed the existing application identity")
    return identifier

def inspect(project, identifier, minimum):
    required = ["build.gradle.kts", "settings.gradle", "gradlew",
                "gradle/wrapper/gradle-wrapper.properties", "app/build.gradle.kts",
                "app/src/main/AndroidManifest.xml",
                f"app/src/main/java/{identifier.replace('.', '/')}/MainActivity.kt"]
    for name in required:
        require((project / name).is_file(), f"Generated Android source missing: {name}")
    gradle = (project / "app/build.gradle.kts").read_text()
    require(re.search(rf'\bapplicationId\s*=\s*"{re.escape(identifier)}"', gradle),
            "Generated application ID differs from existing Nexus identity")
    require(re.search(rf"\bminSdk\s*=\s*{minimum}\b", gradle), "Generated minimum SDK differs")
    activity = (project / required[-1]).read_text()
    require(f"package {identifier}" in activity, "Generated Kotlin package differs")
    require("class MainActivity : TauriActivity()" in activity, "Not a native Tauri host activity")
    manifest = (project / "app/src/main/AndroidManifest.xml").read_text()
    require('android:name=".MainActivity"' in manifest, "Launcher activity is not wired")
    require('android.intent.action.MAIN' in manifest, "Launcher intent is missing")
    files = {}
    omitted = {}
    tooling = "gradle/wrapper/gradle-wrapper.jar"
    for file in sorted(project.rglob("*")):
        require(not file.is_symlink(), "Generated host must not export symbolic links")
        if not file.is_file():
            continue
        name = file.relative_to(project).as_posix()
        require(file.suffix.lower() not in {".apk", ".aab", ".so", ".a", ".dll", ".exe", ".dylib", ".class"},
                f"Generated source unexpectedly contains a compiled payload: {name}")
        require(file.suffix.lower() not in {".jks", ".keystore", ".p12", ".pem"}
                and file.name not in {"key.properties", "keystore.properties"},
                "Signing or credential material must not enter a source artifact")
        payload = file.read_bytes()
        require(not payload.startswith((b"\x7fELF", b"MZ", b"!<arch>\n", b"\xca\xfe\xba\xbe",
                                        b"\xfe\xed\xfa\xce", b"\xfe\xed\xfa\xcf",
                                        b"\xce\xfa\xed\xfe", b"\xcf\xfa\xed\xfe")),
                f"Native/compiled binary was disguised as generated source: {name}")
        digest = hashlib.sha256(payload).hexdigest()
        if name == "local.properties" or name == tooling:
            omitted[name] = digest
        else:
            require(file.suffix.lower() != ".jar", f"Unexpected binary build tool: {name}")
            files[name] = digest
    require(len(files) >= len(required), "No real generated host source was inspected")
    return files, omitted


def mutation_controls(project, identifier, minimum):
    # Mutate what inspect() ACTUALLY reads, restoring exact original bytes each time.
    file = project / "app/build.gradle.kts"
    original = file.read_bytes()
    for bad in [original.replace(identifier.encode(), b"invalid.identity"),
                re.sub(rb"\bminSdk\s*=\s*35\b", b"minSdk = 24", original)]:
        require(bad != original, "Mutation did not touch the actual generated source")
        try:
            file.write_bytes(bad)
            try:
                inspect(project, identifier, minimum)
            except ValueError:
                pass
            else:
                raise AssertionError("Generated-source guard accepted an invalid host")
        finally:
            file.write_bytes(original)
    foreign = project / "foreign-fixture.dll"
    require(not foreign.exists(), "Never overwrite an existing generated file")
    try:
        foreign.write_bytes(b"MZ-negative-control-not-a-real-library")
        try:
            inspect(project, identifier, minimum)
        except ValueError:
            pass
        else:
            raise AssertionError("Generated-source guard accepted a foreign payload")
    finally:
        foreign.unlink()
    disguised = project / "foreign-fixture.asset"
    require(not disguised.exists(), "Never overwrite an existing generated asset")
    try:
        disguised.write_bytes(b"\x7fELF-negative-control-not-a-real-library")
        try:
            inspect(project, identifier, minimum)
        except ValueError:
            pass
        else:
            raise AssertionError("Generated-source guard accepted disguised native code")
    finally:
        disguised.unlink()
    print("Actual generated-source positive control and 4 negative controls passed")


def main():
    require(os.environ.get("GITHUB_ACTIONS") == "true", "Generate/validate Android host only on GitHub")
    base = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())
    android = json.loads((ROOT / "src-tauri/tauri.android.conf.json").read_text())
    identifier = inherited_identity(base, android)
    require(inherited_identity(base, {}) == identifier, "Absent override must inherit base identity")
    for bad in [{"identifier": "invalid.identity"}, {"identifier": None}]:
        try:
            inherited_identity(base, bad)
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid explicit identity override was accepted")
    minimum = android["bundle"]["android"]["minSdkVersion"]
    require(minimum == 35, "Unexpected initial Android API baseline")
    files, omitted = inspect(PROJECT, identifier, minimum)
    mutation_controls(PROJECT, identifier, minimum)
    require((files, omitted) == inspect(PROJECT, identifier, minimum),
            "Negative controls did not restore exact generated source")
    for name in files:
        dest = OUTPUT / "project" / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(PROJECT / name, dest)
    report = dict(sourceCommit=subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip(),
                  generator="tauri-cli 2.11.5", applicationId=identifier, minSdkVersion=minimum,
                  intendedTarget="aarch64-linux-android", sourceHashes=files, omittedMachineOrBinaryTools=omitted,
                  hostSourceGenerated=True, schemaParsedByTauri=True, sourceNegativeControls=4, configNegativeControls=2,
                  gradleConfigured=False, nativeBackendCompiled=False, apkProduced=False,
                  installed=False, deviceTested=False)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Exported {len(files)} generated source/resource files; NO APK/runtime claim")


if __name__ == "__main__":
    main()
