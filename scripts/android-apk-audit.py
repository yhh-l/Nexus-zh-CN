#!/usr/bin/env python3
"""Inspect the actual APK native payload using NDK tools and Android zipalign.

This does not sign, install, upload, or certify runtime/license/device acceptance.
It reuses the existing ELF load-segment validator, not a filename-only ABI check.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / "target/android-apk/native-audit.json"
spec = importlib.util.spec_from_file_location("apk_container", ROOT / "scripts/android-apk-report.py")
container = importlib.util.module_from_spec(spec)
spec.loader.exec_module(container)


def dynamic_dependencies(output, name, bundled, system):
    if "Dynamic section at offset" not in output:
        raise ValueError(f"No actual dynamic section evidence: {name}")
    if re.search(r"\((?:RPATH|RUNPATH)\)", output):
        raise ValueError(f"Unexpected native runtime search path: {name}")
    needed = re.findall(r"\(NEEDED\).*?\[([^\]]+)\]", output)
    if not needed:
        raise ValueError(f"No native dependency evidence: {name}")
    sonames = re.findall(r"\(SONAME\).*?\[([^\]]+)\]", output)
    if sonames and sonames != [name]:
        raise ValueError(f"Packaged native filename/SONAME mismatch: {name}")
    for dependency in needed:
        if dependency not in bundled and dependency not in system:
            raise ValueError(f"Unbundled/non-NDK native dependency: {name} -> {dependency}")
        if "/" in dependency or "\\" in dependency:
            raise ValueError(f"Unsafe native dependency: {name}")
    return needed


def manifest_core(output):
    """Read actual aapt2 badging, not the source XML or Gradle defaults.

    Format: Android SDK aapt2 dump badging (AOSP DumpManifest.cpp).
    Core identity/SDK/launcher/ABI only, NOT a complete component/security audit.
    """
    def exactly(pattern, label):
        values = re.findall(pattern, output, re.MULTILINE)
        if len(values) != 1:
            raise ValueError(f"Missing/ambiguous APK manifest {label}")
        return values[0]

    package = exactly(r"^package: name='([^']+)'", "identity")
    minimum = exactly(r"^(?:minSdkVersion|sdkVersion):'([0-9]+)'$", "minimum SDK")
    target = exactly(r"^targetSdkVersion:'([0-9]+)'", "target SDK")
    launcher = exactly(r"^launchable-activity:\s+name='([^']+)'", "launcher")
    abis = re.findall(r"'([^']+)'", exactly(r"^native-code:(.*)$", "native ABI"))
    if (package != "com.kd9taw.tempo" or minimum != "35" or target != "36" or
            launcher != package + ".NexusLaunchActivity" or abis != ["arm64-v8a"]):
        raise ValueError("Actual APK identity/SDK/launcher/ABI differs from the reviewed Android host")
    if re.search(r"^application-debuggable(?:\s|:|$)", output, re.MULTILINE):
        raise ValueError("Expected the actual non-debuggable release-profile APK")
    permissions = re.findall(r"^uses-permission(?:-sdk-23)?:\s*(?:name=)?'([^']+)'", output, re.MULTILINE)
    if not {"android.permission.INTERNET", "android.permission.RECORD_AUDIO"}.issubset(permissions):
        raise ValueError("Actual APK lost network or native audio-capture permission")
    return {"package": package, "minSdk": int(minimum), "targetSdk": int(target),
            "launcher": launcher, "abis": abis, "debuggable": False,
            "declaredPermissions": sorted(set(permissions)), "coreFieldsVerified": True,
            "fullComponentSecurityAuditComplete": False}


def merged_manifest_components(output):
    """Only decoded final binary Manifest XML is evidence at the audit call site.

    Component exposure is deliberately narrower than a full security audit:
    providers' URI/path grants, backup, network policy and runtime remain separate.
    """
    namespace = "{http://schemas.android.com/apk/res/android}"
    package = "com.kd9taw.tempo"
    root = ET.fromstring(output)
    applications = root.findall("application")
    if root.tag != "manifest" or root.get("package") != package or len(applications) != 1:
        raise ValueError("Missing/ambiguous actual merged manifest identity/application")
    if root.findall("instrumentation"):
        raise ValueError("Instrumentation in release APK")
    application = applications[0]
    if (application.get(namespace + "debuggable", "false") != "false" or
            application.get(namespace + "testOnly", "false") != "false" or
            application.get(namespace + "enabled", "true") != "true" or
            application.get(namespace + "permission")):
        raise ValueError("Unexpected release application debugging/test/entry policy")
    # Derive the trusted panel inventory from its real native routing contract.
    policy = (ROOT / "src-tauri/src/android_panels/policy.rs").read_text()
    panels = re.findall(r'\("[^"\n]+", "([A-Za-z0-9]+PanelActivity)"\)', policy)
    if len(panels) != 17 or len(set(panels)) != 17:
        raise ValueError("Native panel contract changed: review the APK component gate")
    private = {package + "." + name for name in ["MainActivity", "NexusUsbLaunchActivity", *panels]}
    launcher = package + ".NexusLaunchActivity"
    # Exact AndroidX OS-maintenance entry, not a blanket permission-based exemption.
    protected = {("receiver", "androidx.profileinstaller.ProfileInstallReceiver"): "android.permission.DUMP"}
    components = []
    seen = set()
    found_private = set()
    launchers = 0
    for element in application:
        if element.tag not in {"activity", "activity-alias", "service", "receiver", "provider"}:
            continue
        name = element.get(namespace + "name", "")
        if name.startswith("."):
            name = package + name
        elif "." not in name and name:
            name = package + "." + name
        if not re.fullmatch(r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+", name) or name in seen:
            raise ValueError("Missing/ambiguous merged component name")
        seen.add(name)
        filters = element.findall("intent-filter")
        exported = element.get(namespace + "exported")
        if exported is None:
            if filters:
                raise ValueError(f"Ambiguous exported component with intent filters: {name}")
            exported = "false"  # minSdk 35: absent provider exported also defaults false.
        if exported not in {"true", "false"}:
            raise ValueError(f"Unresolved exported component value: {name}")
        permission = element.get(namespace + "permission")
        if name == launcher:
            if (element.tag != "activity" or exported != "true" or permission or
                    element.get(namespace + "enabled", "true") != "true" or len(filters) != 1):
                raise ValueError("Unexpected exported launcher policy")
            actions = [item.get(namespace + "name") for item in filters[0].findall("action")]
            categories = [item.get(namespace + "name") for item in filters[0].findall("category")]
            if (actions != ["android.intent.action.MAIN"] or
                    set(categories) not in ({"android.intent.category.LAUNCHER"},
                                           {"android.intent.category.LAUNCHER", "android.intent.category.LEANBACK_LAUNCHER"}) or
                    len(categories) != len(set(categories)) or filters[0].findall("data")):
                raise ValueError("Unexpected external launcher intent filter")
            launchers += 1
        elif name in private:
            expected_mode = "singleTask" if name.endswith((".MainActivity", ".NexusUsbLaunchActivity")) else "standard"
            # SDK XML decoding may emit the compiled ActivityInfo enum, not its source label.
            mode = element.get(namespace + "launchMode", "standard")
            mode = {"0": "standard", "2": "singleTask"}.get(mode, mode)
            if (element.tag != "activity" or exported != "false" or filters or
                    element.get(namespace + "enabled", "true") != "true" or
                    mode != expected_mode):
                raise ValueError(f"Native station/panel component is no longer private: {name}; "
                                 f"exported={exported}, mode={mode}, filters={len(filters)}")
            found_private.add(name)
        elif exported == "true":
            required = protected.get((element.tag, name))
            if required is None or permission != required:
                raise ValueError(f"Unreviewed exported merged component: {name}")
        components.append({"kind": element.tag, "name": name, "exported": exported == "true",
                           "permission": permission})
    if launchers != 1 or found_private != private:
        raise ValueError("Missing actual merged launcher or private native station/panel component")
    return {"components": components, "privateNativeActivityCount": len(private),
            "mergedManifestComponentExposureVerified": True, "fullComponentSecurityAuditComplete": False}


def run(command):
    try:
        return subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=True, timeout=180).stdout
    except subprocess.CalledProcessError as error:
        # Preserve the real validator's reason, not just its nonzero exit status.
        raise RuntimeError(f"APK audit tool failed (exit {error.returncode}): {command[0]}\n"
                           f"{error.stdout or ''}{error.stderr or ''}") from error


def compiled_manifest(apk, sdk):
    # Read the built APK, not the repository XML or a separately generated manifest.
    tools = Path(sdk) / "cmdline-tools/latest"
    analyzer = tools / "bin/apkanalyzer"
    properties = tools / "source.properties"
    if not analyzer.is_file() or not properties.is_file():
        raise ValueError("Actual SDK apkanalyzer and its revision metadata required")
    result = merged_manifest_components(run([str(analyzer), "manifest", "print", str(apk)]))
    result["decoder"] = {"tool": "Android SDK apkanalyzer manifest print",
                         "launcherSha256": hashlib.sha256(analyzer.read_bytes()).hexdigest(),
                         "sdkSourceProperties": properties.read_text()}
    return result


def audit(apk, ndk, sdk):
    # Reinspect actual bytes; never trust a previously generated checkpoint alone.
    checkpoint = container.inspect(apk)
    ndk = Path(ndk)
    sdk = Path(sdk)
    toolchain = ndk / "toolchains/llvm/prebuilt/linux-x86_64"
    readelf = toolchain / "bin/llvm-readelf"
    system_dir = toolchain / "sysroot/usr/lib/aarch64-linux-android/35"
    if not readelf.is_file() or not system_dir.is_dir():
        raise ValueError("Real NDK AArch64 API 35 tools/libraries required")
    system = {file.name for file in system_dir.glob("*.so") if file.is_file()}
    if not {"libc.so", "libm.so", "libdl.so"}.issubset(system):
        raise ValueError("Incomplete actual Android API 35 public-library inventory")
    # Pin the SDK tool rather than silently taking the first installed version.
    zipalign = sdk / "build-tools/36.0.0/zipalign"
    if not zipalign.is_file():
        raise ValueError("Android SDK build-tools 36.0.0 zipalign required")
    # Checks the ORIGINAL APK. Never rezip/realign it behind the build's back.
    alignment = run([str(zipalign), "-c", "-P", "16", "-v", "4", str(apk)])
    aapt2 = sdk / "build-tools/36.0.0/aapt2"
    if not aapt2.is_file():
        raise ValueError("Actual Android SDK aapt2 is required")
    manifest = manifest_core(run([str(aapt2), "dump", "badging", str(apk)]))
    components = compiled_manifest(apk, sdk)
    names = checkpoint["nativeLibraries"]
    bundled = {Path(name).name for name in names}
    records = []
    with tempfile.TemporaryDirectory(prefix="nexus-apk-native-") as directory:
        with zipfile.ZipFile(apk) as archive:
            for member in names:
                # Container guard already excludes nesting/traversal/duplicates.
                output = Path(directory) / Path(member).name
                output.write_bytes(archive.read(member))
        files = [str(Path(directory) / Path(member).name) for member in names]
        # Same actual validator used by the whole-modem link gate and its corruption controls.
        program = (
            "import fs from 'node:fs'; "
            "import {inspectSharedObject} from './scripts/android-native-link.mjs'; "
            "console.log(JSON.stringify(process.argv.slice(1).map(file => inspectSharedObject(fs.readFileSync(file)))));"
        )
        elf_checks = json.loads(run(["node", "--input-type=module", "-e", program, *files]))
        if len(elf_checks) != len(names):
            raise ValueError("Missing native ELF inspection result")
        for member, file, elf in zip(names, files, elf_checks):
            name = Path(member).name
            needed = dynamic_dependencies(run([str(readelf), "--dynamic", file]), name, bundled, system)
            versions = run([str(readelf), "--version-info", file])
            if re.search(r"\bGLIBC_[0-9]", versions):
                raise ValueError(f"GNU/Linux GLIBC dependency in Android APK: {name}")
            records.append({"member": member, "sha256": hashlib.sha256(Path(file).read_bytes()).hexdigest(),
                            "elf": elf, "needed": needed})
    return {"schemaVersion": 1, "apkSha256": checkpoint["sha256"], "nativeLibraries": records, "manifestCore": manifest,
            "manifestComponents": components,
            "systemLibrarySource": "actual NDK AArch64 Android API 35 sysroot",
            "elfAndZip16KiBVerified": True, "neededLibraryClosureVerified": True,
            "zipalignOutput": alignment, "signatureVerified": False, "installableVerified": False,
            "runtimeNoticesAndSourceAuditComplete": False, "deviceTested": False, "distributable": False}


def main():
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise ValueError("APK native audit is cloud-only")
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.unlink(missing_ok=True)
    apks = sorted(container.OUTPUTS.rglob("*.apk"))
    if len(apks) != 1:
        raise ValueError("Expected one actual APK, not a selected fixture")
    result = audit(apks[0], os.environ["ANDROID_NDK_HOME"], os.environ["ANDROID_HOME"])
    result["sourceRevision"] = os.environ["GITHUB_SHA"]
    REPORT.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
