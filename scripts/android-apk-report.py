#!/usr/bin/env python3
"""Inspect actual unsigned build output. Not a license, install, signature or runtime gate.

Never upload the APK from this milestone. Final payload/alignment/notice/runtime/device
acceptance is separate; this report deliberately cannot declare a distributable APK.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import struct
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUTPUTS = ROOT / "src-tauri/gen/android/app/build/outputs/apk"
REPORT = ROOT / "target/android-apk/build-report.json"
MODEL_SHA256 = "a7b3b4aa2610d3e88b8c7d4420eceee31be2d0ae595b3413264334f3ffb1eab5"


def inspect(apk):
    apk = Path(apk)
    if not apk.is_file() or apk.stat().st_size == 0:
        raise ValueError("No nonempty actual APK output")
    native = []
    model = False
    dex = False
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("APK has duplicate members")
        if "AndroidManifest.xml" not in names:
            raise ValueError("APK has no Android manifest")
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in entry.filename:
                raise ValueError("APK contains an unsafe path")
            if entry.is_dir():
                continue
            with archive.open(entry) as stream:
                header = stream.read(64)
            if path.suffix.lower() in (".dll", ".exe", ".dylib", ".a", ".rlib") or header[:2] == b"MZ":
                raise ValueError("APK contains desktop/build-only native payload")
            elf = header[:4] == b"\x7fELF"
            if path.suffix == ".so" or elf:
                if len(path.parts) != 3 or path.parts[:2] != ("lib", "arm64-v8a") or path.suffix != ".so":
                    raise ValueError("Native code is not exclusively lib/arm64-v8a/*.so")
                if (len(header) != 64 or header[:7] != b"\x7fELF\x02\x01\x01" or
                        struct.unpack_from("<HHI", header, 16) != (3, 183, 1)):
                    raise ValueError("Native library is not an AArch64 ELF64 shared object")
                native.append(entry.filename)
            if entry.filename == "classes.dex":
                dex = header[:4] == b"dex\n"
            if entry.filename.endswith("/resources/deepcw/model.onnx") or entry.filename == "assets/resources/deepcw/model.onnx":
                with archive.open(entry) as stream:
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()
                if digest != MODEL_SHA256:
                    raise ValueError("Packaged AI CW model differs from the verified model")
                model = True
        if not dex or "lib/arm64-v8a/libtempo_lib.so" not in native:
            raise ValueError("APK is missing real DEX or the complete native application library")
        if not model:
            raise ValueError("APK is missing the actual AI CW model; never accept a model-less package")
        if archive.testzip() is not None:
            raise ValueError("APK member checksum failed")
    with apk.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {
        "schemaVersion": 1,
        "milestone": "unsigned-apk-container-and-arm64-header-check",
        "apkProduced": True,
        "bytes": apk.stat().st_size,
        "sha256": digest,
        "nativeLibraries": sorted(native),
        "aiCwModelHashVerified": model,
        "signatureVerified": False,
        "installableVerified": False,
        "fullPayloadAuditComplete": False,
        "elfAndZip16KiBVerified": False,
        "runtimeNoticesAndSourceAuditComplete": False,
        "deviceTested": False,
        "distributable": False,
    }


def main():
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise ValueError("APK build inspection is cloud-only")
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.unlink(missing_ok=True)
    candidates = sorted(OUTPUTS.rglob("*.apk"))
    if len(candidates) != 1:
        raise ValueError(f"Expected one exact ARM64 APK, found {len(candidates)}")
    report = inspect(candidates[0])
    report["sourceRevision"] = os.environ["GITHUB_SHA"]
    report["output"] = candidates[0].relative_to(ROOT).as_posix()
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()