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
import sys
import xml.etree.ElementTree as ET

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
    manifest = ET.parse(project / "app/src/main/AndroidManifest.xml").getroot()
    android = "{http://schemas.android.com/apk/res/android}"
    app = manifest.find("application")
    require(app is not None and app.get(android + "icon") == "@drawable/nexus_launcher",
            "Launcher must use reviewed Nexus artwork, not template artwork")
    activity = next((node for node in app.findall("activity")
                     if node.get(android + "name") == ".MainActivity"), None)
    require(activity is not None and activity.get(android + "exported") == "true",
            "Launcher activity is not wired")
    require(any(
        any(node.get(android + "name") == "android.intent.action.MAIN" for node in intent.findall("action"))
        and any(node.get(android + "name") == "android.intent.category.LAUNCHER" for node in intent.findall("category"))
        for intent in activity.findall("intent-filter")), "Launcher intent is missing")
    icon = project / "app/src/main/res/drawable-nodpi/nexus_launcher.png"
    require(icon.read_bytes() == (ROOT / "src-tauri/icons/icon-source.png").read_bytes(),
            "Android launcher must preserve the existing Nexus master artwork")
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
    icon = project / "app/src/main/res/drawable-nodpi/nexus_launcher.png"
    original_icon = icon.read_bytes()
    try:
        icon.write_bytes(original_icon + b"negative-control")
        try:
            inspect(project, identifier, minimum)
        except ValueError:
            pass
        else:
            raise AssertionError("Generated-source guard accepted changed launcher artwork")
    finally:
        icon.write_bytes(original_icon)
    print("Actual generated-source positive control and 5 negative controls passed")


def verify_export(directory):
    """Check the actual downloaded artifact, not just the pre-upload directory."""
    expected_report = (OUTPUT / "report.json").read_bytes()
    require((directory / "report.json").read_bytes() == expected_report,
            "Downloaded host provenance differs from the generated report")
    hashes = json.loads(expected_report)["sourceHashes"]
    expected = {"report.json"} | {f"project/{name}" for name in hashes}
    actual = set()
    for file in directory.rglob("*"):
        require(not file.is_symlink(), "Downloaded source contains a symbolic link")
        if file.is_file():
            actual.add(file.relative_to(directory).as_posix())
    require(actual == expected, "Downloaded source inventory differs (including hidden files)")
    for name, digest in hashes.items():
        require(hashlib.sha256((directory / "project" / name).read_bytes()).hexdigest() == digest,
                f"Downloaded generated source changed: {name}")
    return len(hashes)


def verify_roundtrip(directory):
    count = verify_export(directory)
    # Exercise the same downloaded artifact: absent dotfile, changed bytes, extra payload.
    file = directory / "project/.editorconfig"
    original = file.read_bytes()
    extra = directory / "project/unexpected-payload.dll"
    require(not extra.exists(), "Never overwrite an existing artifact member")
    try:
        for mutation in ("missing", "changed", "extra"):
            if mutation == "missing":
                file.unlink()
            elif mutation == "changed":
                file.write_bytes(original + b"\n# negative control\n")
            else:
                extra.write_bytes(b"MZ-negative-control-not-a-real-library")
            try:
                verify_export(directory)
            except (ValueError, FileNotFoundError):
                pass
            else:
                raise AssertionError(f"Artifact roundtrip accepted {mutation} source")
            finally:
                file.write_bytes(original)
                if extra.exists():
                    extra.unlink()
    finally:
        file.write_bytes(original)
        if extra.exists():
            extra.unlink()
    require(verify_export(directory) == count, "Roundtrip controls did not restore source")
    print(f"Downloaded artifact: {count} exact source hashes and 3 negative controls passed")


def main():
    require(os.environ.get("GITHUB_ACTIONS") == "true", "Generate/validate Android host only on GitHub")
    if len(sys.argv) == 3 and sys.argv[1] == "--verify-export":
        verify_roundtrip(Path(sys.argv[2]))
        return
    require(len(sys.argv) == 1, "Expected no arguments or --verify-export DIRECTORY")
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
                  hostSourceGenerated=True, schemaParsedByTauri=True, sourceNegativeControls=5, configNegativeControls=2,
                  gradleConfigured=False, nativeBackendCompiled=False, apkProduced=False,
                  installed=False, deviceTested=False)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Exported {len(files)} generated source/resource files; NO APK/runtime claim")


if __name__ == "__main__":
    main()
