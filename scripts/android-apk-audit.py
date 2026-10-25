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
    minimum = exactly(r"^sdkVersion:'([0-9]+)'", "minimum SDK")
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


def run(command):
    return subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=True).stdout


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
