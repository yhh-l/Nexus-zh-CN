#!/usr/bin/env python3
"""Exact target Rust notice delivery, not complete dependency/source/license approval.

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
    result.update({"androidRustResourcePayloadVerified": True, "resourceMember": MEMBER,
                   "androidProjectNoticePayloadVerified": True,
                   "projectNoticeMember": PROJECT_NOTICE_MEMBER, "projectNoticeBytes": len(project_notice),
                   "projectNoticeSha256": hashlib.sha256(project_notice).hexdigest()})
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
