#!/usr/bin/env python3
"""Cloud-only notices for the locked Android Rust graph; NOT whole-APK compliance.

Reuse the desktop generator's reviewed per-package text/choice policy, not its
four desktop targets. Java/Kotlin, NDK/native inputs, corresponding source and
actual APK notice delivery remain separate, mandatory prerequisites.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tomllib

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "target/android-notices"
TARGET = "aarch64-linux-android"
# Tauri CLI 2.11.5 Rust::build_options adds tauri/custom-protocol for mobile release.
FEATURES = "radio,yaesu-wf,tauri/custom-protocol"
spec = importlib.util.spec_from_file_location("rust_notices", ROOT / "scripts/gen-rust-licenses.py")
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def selected_packages(metadata, tree):
    packages = {}
    for package in metadata["packages"]:
        key = (package["name"], package["version"])
        if key in packages:
            raise ValueError(f"Ambiguous Cargo package identity: {key}")
        packages[key] = package
    root = metadata["resolve"]["root"]
    roots = [p for p in packages.values() if p["id"] == root]
    if len(roots) != 1 or roots[0]["name"] != "tempo":
        raise ValueError("Expected the actual src-tauri application root")
    selected = set(re.findall(r"(?m)^(\S+) v(\S+)", tree))
    root_key = (roots[0]["name"], roots[0]["version"])
    if root_key not in selected or selected - packages.keys():
        raise ValueError("Cargo tree is missing its root or disagrees with actual metadata")
    third_party = [packages[key] for key in selected if packages[key]["source"]]
    if not {"tauri", "jni"}.issubset({p["name"] for p in third_party}):
        raise ValueError("The Android application graph must include Tauri and real JNI")
    return sorted(third_party, key=lambda p: (p["name"], policy.version_key(p["version"])))


def merge_android_pins(desktop, android):
    """Keep desktop policy unchanged; refuse accidental replacement of reviewed pins."""
    merged = {}
    for section in ("sha256", "crates"):
        if desktop[section].keys() & android[section].keys():
            raise ValueError(f"Android pins collide with desktop {section}")
        merged[section] = {**desktop[section], **android[section]}
    return merged


def package_entry(package, allowed, rank, upstream, android, used):
    key = f"{package['name']} {package['version']}"
    selected_rank = rank
    if key in android["crates"]:
        elected = frozenset(android["crates"][key]["license"].split(" AND "))
        if not elected <= allowed or elected not in policy.alternatives(package["license"]):
            raise policy.Stop(f"{key}: reviewed Android election is not an allowed package alternative")
        # tao-macros publishes no license body; the exact release repository has
        # Apache-2.0, not MIT. Select that declared alternative, never invent MIT.
        selected_rank = {license: priority + 1 for license, priority in rank.items()}
        for license in elected:
            selected_rank[license] = 0
    return policy.entry(package, allowed, selected_rank, upstream, used)


def main():
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise ValueError("Android notice generation is GitHub-only")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    notices = OUTPUT / "RUST-THIRD-PARTY.txt"
    report_path = OUTPUT / "rust-report.json"
    notices.unlink(missing_ok=True)
    report_path.unlink(missing_ok=True)
    report = {"schemaVersion": 1, "sourceRevision": os.environ["GITHUB_SHA"],
              "target": TARGET, "features": FEATURES.split(","),
              "edgeScope": "cargo tree -e normal, including proc-macro dependencies",
              "rustNoticeGenerationComplete": False, "apkPayloadVerified": False,
              "runtimeNoticesAndSourceAuditComplete": False, "distributable": False,
              "packages": [], "problems": []}
    try:
        metadata = json.loads(policy.cargo("metadata", "--format-version", "1",
                                         "--filter-platform", TARGET, "--features", FEATURES))
        tree = policy.cargo("tree", "--target", TARGET, "--features", FEATURES,
                            "-e", "normal", "--prefix", "none", "--format", "{p}")
        packages = selected_packages(metadata, tree)
        with (ROOT / "deny.toml").open("rb") as handle:
            allowed = tomllib.load(handle)["licenses"]["allow"]
        rank = {license: i for i, license in enumerate(
            policy.PREFERENCE + [a for a in allowed if a not in policy.PREFERENCE])}
        desktop = json.loads(Path(policy.UPSTREAM).read_text())
        android = json.loads((ROOT / "licenses/rust/android-upstream.json").read_text())
        upstream = merge_android_pins(desktop, android)
        used, entries = set(), []
        for package in packages:
            item = {key: package.get(key) for key in ("name", "version", "source", "license", "repository")}
            try:
                text = package_entry(package, set(allowed), rank, upstream, android, used)
                item["noticeSha256"] = hashlib.sha256(text.encode()).hexdigest()
                entries.append(text)
            except policy.Stop as error:
                item["problem"] = str(error)
                report["problems"].append(str(error))
            report["packages"].append(item)
        # Desktop-only pins are intentionally not required by this target subset.
        # Every pin actually used still goes through the existing hash/provenance check.
        report["reviewedPinsUsed"] = sorted(used)
        report["reviewedAndroidPinsUsed"] = sorted(used & android["crates"].keys())
        unused = android["crates"].keys() - used
        if unused:
            report["problems"].append(f"Android pins no longer used: {sorted(unused)}")
        if not report["problems"]:
            header = ("Nexus Android ARM64 - Rust dependency notices\n\n"
                      "Locked radio/yaesu-wf/custom-protocol normal-edge Rust graph only.\n"
                      "This is not Java/Kotlin/native-source coverage or APK delivery evidence.\n\n")
            text = header + "\n".join(entries)
            notices.write_text(text, encoding="utf-8", newline="\n")
            report["noticeBytes"] = len(text.encode())
            report["noticeSha256"] = hashlib.sha256(text.encode()).hexdigest()
            report["rustNoticeGenerationComplete"] = True
    except (policy.Stop, OSError, ValueError, KeyError) as error:
        report["problems"].append(str(error))
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["rustNoticeGenerationComplete"] else 2


if __name__ == "__main__":
    sys.exit(main())
