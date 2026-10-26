#!/usr/bin/env python3
"""Explicitly approved, cloud-only ephemeral TEST signing; never a release gate.

Private keys/passwords exist only in a runner-temp directory/process environment.
Only the signed APK, public certificate digest and honest inspection reports may
leave the runner. No existing release or runtime/source acceptance flag is relaxed.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
ANDROID = "{http://schemas.android.com/apk/res/android}"


def require_context(env):
    if (env.get("GITHUB_ACTIONS") != "true" or
            env.get("GITHUB_EVENT_NAME") != "workflow_dispatch" or
            env.get("GITHUB_REF") != "refs/heads/codex/android-arm64" or
            env.get("NEXUS_ANDROID_TEST_APK") != "true"):
        raise ValueError("Manual, branch-scoped test-signing approval required")
    if not re.fullmatch(r"[0-9a-f]{40}", env.get("GITHUB_SHA", "")):
        raise ValueError("Exact current source revision required")


def version_config(base_version, run_number):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", base_version):
        raise ValueError("A stable base version is required; never increment public versions")
    if not re.fullmatch(r"[1-9][0-9]*", run_number):
        raise ValueError("Actual workflow run number required")
    return {"version": f"{base_version}-android-test.{run_number}"}


def run_private(command, env):
    # Never include argv/env/tool output in an exception: a tool can echo secrets.
    result = subprocess.run([str(part) for part in command], env=env, text=True,
                            capture_output=True, timeout=180)
    if result.returncode:
        raise ValueError(f"Test signing tool {Path(command[0]).name} failed (exit {result.returncode})")
    return result.stdout


def signature_evidence(output):
    for scheme in (2, 3):
        if not re.search(rf"Verified using v{scheme} scheme [^\n]*: true", output):
            raise ValueError("Actual APK v2 and v3 signature verification required")
    digests = re.findall(r"Signer #[0-9]+ certificate SHA-256 digest: ([0-9a-fA-F]{64})", output)
    if len(digests) != 1:
        raise ValueError("Exactly one actual test signer required")
    return digests[0].lower()


def sign_apk(unsigned, signed, sdk, java, temp_root):
    sdk, java, temp_root = Path(sdk), Path(java), Path(temp_root)
    apksigner = sdk / "build-tools/36.0.0/apksigner"
    keytool = java / "bin/keytool"
    for tool in (apksigner, keytool):
        if not tool.is_file():
            raise ValueError("Pinned Android build-tools 36.0.0 and runner keytool required")
    # Temp root is validated outside the checkout by the production entrypoint.
    with tempfile.TemporaryDirectory(prefix="nexus-test-signing-", dir=temp_root) as private:
        os.chmod(private, 0o700)
        key = Path(private) / "test.p12"
        env = dict(os.environ)
        env["NEXUS_TEST_STOREPASS"] = secrets.token_urlsafe(48)
        try:
            run_private([keytool, "-genkeypair", "-storetype", "PKCS12", "-keystore", key,
                         "-alias", "nexus-test", "-keyalg", "RSA", "-keysize", "3072",
                         "-validity", "30", "-dname", "CN=Nexus Android Internal Test",
                         "-storepass:env", "NEXUS_TEST_STOREPASS",
                         "-keypass:env", "NEXUS_TEST_STOREPASS", "-noprompt"], env)
            os.chmod(key, 0o600)
            run_private([apksigner, "sign", "--ks", key, "--ks-key-alias", "nexus-test",
                         "--ks-pass", "env:NEXUS_TEST_STOREPASS", "--key-pass", "env:NEXUS_TEST_STOREPASS",
                         "--v1-signing-enabled", "false", "--v2-signing-enabled", "true",
                         "--v3-signing-enabled", "true", "--v4-signing-enabled", "false",
                         "--out", signed, unsigned], env)
            # First use the APK's REAL minSdk (35). Additionally verify from API 24
            # so apksig exercises v2 as well as v3, rather than skipping an older
            # scheme which Android 15 itself does not need. Do not change minSdk.
            run_private([apksigner, "verify", "--verbose", "--print-certs", signed], env)
            output = run_private([apksigner, "verify", "--min-sdk-version", "24",
                                  "--verbose", "--print-certs", signed], env)
            return signature_evidence(output)
        finally:
            env.pop("NEXUS_TEST_STOREPASS", None)
    # TemporaryDirectory removes the keystore on both success and failure.


def payload_digest(apk):
    with Path(apk).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load_audit():
    spec = importlib.util.spec_from_file_location("android_test_audit", ROOT / "scripts/android-apk-audit.py")
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)
    return audit


def main():
    env = dict(os.environ)
    require_context(env)
    temp_root = Path(env["RUNNER_TEMP"]).resolve()
    if temp_root.is_relative_to(ROOT.resolve()) or not temp_root.is_dir():
        raise ValueError("Runner temporary storage must be outside the checkout")
    config = version_config(json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())["version"],
                            env.get("GITHUB_RUN_NUMBER", ""))
    config_path = temp_root / "nexus-android-test-version.json"
    if sys.argv[1:] == ["--prepare-version"]:
        config_path.write_text(json.dumps(config) + "\n")
        return
    if sys.argv[1:]:
        raise ValueError("Unexpected test signing argument")
    if json.loads(config_path.read_text()) != config:
        raise ValueError("Actual prerelease build configuration required")
    audit = load_audit()
    apks = sorted(audit.container.OUTPUTS.rglob("*.apk"))
    if len(apks) != 1:
        raise ValueError("Exactly one complete actual APK required")
    unsigned = apks[0]
    checkpoint = json.loads((ROOT / "target/android-apk/build-report.json").read_text())
    previous = json.loads((ROOT / "target/android-apk/native-audit.json").read_text())
    digest = payload_digest(unsigned)
    if (checkpoint.get("sourceRevision") != env["GITHUB_SHA"] or checkpoint.get("sha256") != digest or
            previous.get("sourceRevision") != env["GITHUB_SHA"] or previous.get("apkSha256") != digest or
            previous.get("elfAndZip16KiBVerified") is not True or
            previous.get("neededLibraryClosureVerified") is not True):
        raise ValueError("Current actual unsigned APK audit required before signing")
    output = ROOT / "target/android-test-apk"
    output.mkdir(parents=True, exist_ok=False)
    signed = output / "Nexus-Android-ARM64-test.apk"
    try:
        certificate = sign_apk(unsigned, signed, env["ANDROID_HOME"], env["JAVA_HOME"], temp_root)
        # Audit the SIGNED bytes afresh; signatures are not a substitute for ABI,
        # 16 KiB alignment, model, source-bound notices or component exposure checks.
        result = audit.audit(signed, env["ANDROID_NDK_HOME"], env["ANDROID_HOME"])
        analyzer = Path(env["ANDROID_HOME"]) / "cmdline-tools/latest/bin/apkanalyzer"
        manifest = ET.fromstring(audit.run([str(analyzer), "manifest", "print", str(signed)]))
        if manifest.attrib.get(ANDROID + "versionName") != config["version"]:
            raise ValueError("Final APK must carry the exact prerelease test version")
        result.update({"sourceRevision": env["GITHUB_SHA"], "versionName": config["version"],
                       "milestone": "approved-internal-signed-test-apk-not-a-public-release",
                       "signatureVerified": True, "certificateSha256": certificate,
                       "ephemeralTestKey": True, "privateKeyExported": False,
                       "unsignedApkSha256": digest, "bytes": signed.stat().st_size,
                       "installableVerified": False, "deviceTested": False, "distributable": False})
        (output / "test-signing-report.json").write_text(json.dumps(result, indent=2) + "\n")
        (output / "SHA256SUMS.txt").write_text(f"{result['apkSha256']}  {signed.name}\n")
        (output / "READ-ME-FIRST.txt").write_text(
            "Nexus Android ARM64 INTERNAL TEST ONLY. Android 15/API 35 or newer.\n"
            "Ephemeral test certificate; a later key may require data backup and uninstall.\n"
            "Signature/ABI/16-KiB/model/notice checks passed, NOT physical device acceptance.\n"
            "Full source/license/security review remains incomplete. No public release claim.\n"
            "Android station-side window streaming remains unsupported.\n"
            "TX defaults OFF. Do not use on-air transmission as a smoke test.\n"
            "Back up logbook/settings before installation. Report S25 Ultra install/start failures.\n")
        print(json.dumps({"testApk": signed.name, "sha256": result["apkSha256"],
                          "versionName": config["version"], "signatureVerified": True}))
    except BaseException:
        # Fail closed: never leave a package eligible for the workflow upload.
        for file in output.iterdir():
            if file.is_file():
                file.unlink()
        output.rmdir()
        raise


if __name__ == "__main__":
    main()
