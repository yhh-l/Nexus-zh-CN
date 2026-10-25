#!/usr/bin/env python3
"""Exact Rust, project and scoped JVM notice delivery, not complete license approval.

The frontend-only CLI never claims an APK inspection. The final native APK audit
calls inspect_apk on the original generated APK, without modifying its bytes.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FEATURES = ["radio", "yaesu-wf", "tauri/custom-protocol"]
MEMBER = "assets/resources/rust/THIRD-PARTY.txt"
PROJECT_NOTICE_MEMBER = "assets/NOTICE"
# Exact source texts reviewed at the release's immutable upstream commit.
# These two deliveries are NOT complete Java/Kotlin source or license coverage.
SUPPLEMENTAL_NOTICES = {
    "resources/android-jvm/kotlinx-coroutines-1.9.0/LICENSE.txt": {
        "source": "licenses/android-jvm/kotlinx-coroutines-1.9.0/LICENSE.txt",
        "sha256": "b1febe6399dffb10d19d35e7663ab16300c93cb0476a94115df1cc0097a8ffd8"},
    "resources/android-jvm/kotlinx-coroutines-1.9.0/NOTICE.txt": {
        "source": "licenses/android-jvm/kotlinx-coroutines-1.9.0/NOTICE.txt",
        "sha256": "421d45acbd92670b4131621a28fcbb41ba0b747d3a336cb13fca38c0685426c4"},
}


SUPPLEMENTAL_COMPONENTS = {
    "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0":
        "dd4d70dbc424eb0492126446b4035821d40d255664a8a36091d357f11390bc50",
    "org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0":
        "abd6b4a8588f6117f4ed2787c4ec7b2f9c25daa403b3b4bbcf26fa4e0a725398",
    "org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.9.0":
        "01e0f26a274d8f2f2ae702b161bc0980cea817bfcaf66ca4944434ea7b601771",
}


def inspect_supplements(archive, root, revision):
    inputs = json.loads((Path(root) / "target/android-jvm/runtime-inventory.json").read_text())
    components = inputs.get("components", [])
    by_key = {item["key"]: item for item in components}
    if (inputs.get("schemaVersion") != 1 or inputs.get("resolutionFailureCount") != 0 or
            inputs.get("sourceRevision") != revision or inputs.get("syntheticFixture") is not False or
            inputs.get("runtimeInputResolutionComplete") is not True or
            inputs.get("artifactSelection") != "android-aar-or-jar" or len(by_key) != len(components)):
        raise ValueError("Supplemental JVM notice review requires actual current resolved inputs")
    for key, expected in SUPPLEMENTAL_COMPONENTS.items():
        item = by_key.get(key, {})
        if item.get("kind") != "module" or item.get("sourcesResolved") is not True or item.get("sourcesSha256") != expected:
            raise ValueError("Supplemental JVM notice review no longer matches resolved inputs: " + key)
    records = []
    for resource, pin in SUPPLEMENTAL_NOTICES.items():
        text = (Path(root) / pin["source"]).read_bytes()
        if not text or hashlib.sha256(text).hexdigest() != pin["sha256"]:
            raise ValueError("Supplemental JVM source notice SHA256 mismatch: " + resource)
        member = "assets/" + resource
        if archive.namelist().count(member) != 1:
            raise ValueError("Missing or duplicate APK supplemental JVM notice: " + member)
        entry = archive.getinfo(member)
        if entry.file_size != len(text) or archive.read(entry) != text:
            raise ValueError("APK supplemental JVM notice bytes differ from reviewed source: " + member)
        records.append({"resourceMember": member, "bytes": len(text), "sha256": pin["sha256"]})
    return records


def inventory(root, revision):
    root = Path(root)
    if not isinstance(revision, str) or not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Actual cloud source revision required for Rust notices")
    directory = root / "target/android-notices"
    report = json.loads((directory / "rust-report.json").read_text())
    text = (directory / "RUST-THIRD-PARTY.txt").read_bytes()
    if (report.get("schemaVersion") != 1 or report.get("sourceRevision") != revision or
            report.get("target") != "aarch64-linux-android" or report.get("features") != FEATURES or
            report.get("rustNoticeGenerationComplete") is not True or report.get("problems") != [] or
            not text or report.get("noticeBytes") != len(text) or
            report.get("noticeSha256") != hashlib.sha256(text).hexdigest()):
        raise ValueError("Stale, incomplete or mismatched Android Rust notice inventory")
    return text


def inspect_frontend(root, revision):
    text = inventory(root, revision)
    emitted = Path(root) / "ui/dist/rust/THIRD-PARTY.txt"
    if emitted.read_bytes() != text:
        raise ValueError("Actual frontend Rust notice asset differs from target inventory")
    return {"schemaVersion": 1, "sourceRevision": revision, "noticeBytes": len(text),
            "noticeSha256": hashlib.sha256(text).hexdigest(), "frontendRustNoticeEmissionVerified": True,
            "androidRustResourcePayloadVerified": False, "androidProjectNoticePayloadVerified": False,
            "androidJvmSupplementalNoticePayloadVerified": False,
            "runtimeDisplayVerified": False,
            "runtimeNoticesAndSourceAuditComplete": False, "distributable": False}


def inspect_apk(apk, root, revision):
    result = inspect_frontend(root, revision)
    text = inventory(root, revision)
    with zipfile.ZipFile(apk) as archive:
        if archive.namelist().count(MEMBER) != 1:
            raise ValueError("Missing or duplicate APK Android Rust notice resource")
        entry = archive.getinfo(MEMBER)
        if entry.file_size != len(text) or archive.read(entry) != text:
            raise ValueError("Actual APK Rust notice bytes differ from target inventory")
        project_notice = (Path(root) / "NOTICE").read_bytes()
        if not project_notice:
            raise ValueError("Empty project NOTICE input")
        if archive.namelist().count(PROJECT_NOTICE_MEMBER) != 1:
            raise ValueError("Missing or duplicate APK project NOTICE resource")
        project_entry = archive.getinfo(PROJECT_NOTICE_MEMBER)
        if project_entry.file_size != len(project_notice) or archive.read(project_entry) != project_notice:
            raise ValueError("Actual APK project NOTICE bytes differ from source")
        supplements = inspect_supplements(archive, root, revision)
    result.update({"androidRustResourcePayloadVerified": True, "resourceMember": MEMBER,
                   "androidProjectNoticePayloadVerified": True,
                   "projectNoticeMember": PROJECT_NOTICE_MEMBER, "projectNoticeBytes": len(project_notice),
                   "projectNoticeSha256": hashlib.sha256(project_notice).hexdigest(),
                   "androidJvmSupplementalNoticePayloadVerified": True,
                   "supplementalJvmNoticeResources": supplements})
    return result


def main():
    if os.environ.get("GITHUB_ACTIONS") != "true" or sys.argv[1:] != ["--frontend-only"]:
        raise ValueError("Cloud frontend-only invocation required; full APK audit has its own mandatory gate")
    result = inspect_frontend(ROOT, os.environ["GITHUB_SHA"])
    path = ROOT / "target/android-notices/frontend-report.json"
    path.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
