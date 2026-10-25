#!/usr/bin/env python3
"""Collect hash-bound JVM source comments for review, NEVER approve licensing/APK delivery.

Original stdlib-only reader. Downloads only published sources from fixed Maven origins;
no extraction, compilation, code execution, dependency mutation, signing or credentials.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile

MAX_ARCHIVE = 64 * 1024 * 1024
MAX_ENTRY = 8 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
MAX_HEADER = 64 * 1024
ORIGINS = ("https://dl.google.com/dl/android/maven2/", "https://repo.maven.apache.org/maven2/")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_inventory(data, expected_revision, expected_hash):
    require(re.fullmatch(r"[a-f0-9]{40}", expected_revision), "Exact inventory revision required")
    require(re.fullmatch(r"[a-f0-9]{64}", expected_hash), "Exact inventory SHA256 required")
    require(digest(data) == expected_hash, "Downloaded inventory SHA256 mismatch")
    report = json.loads(data)
    require(report.get("sourceRevision") == expected_revision, "Inventory revision mismatch")
    require(report.get("syntheticFixture") is False, "Synthetic inventory is not Android evidence")
    require(report.get("runtimeInputResolutionComplete") is True, "Actual runtime input resolution required")
    require(report.get("artifactSelection") == "android-aar-or-jar", "Actual typed Android input view required")
    components = report["components"]
    require(components and len({item["key"] for item in components}) == len(components), "Ambiguous/empty components")
    return report


def source_urls(component):
    parts = [component[name] for name in ("group", "module", "version")]
    require(all(isinstance(part, str) and re.fullmatch(r"[A-Za-z0-9_.-]+", part)
                and all(piece not in ("", ".", "..") for piece in part.split(".")) for part in parts),
            "Invalid Maven source identity")
    group, module, version = parts
    require(component["key"] == f"{group}:{module}:{version}", "Maven component identity mismatch")
    relative = f"{group.replace('.', '/')}/{module}/{version}/{module}-{version}-sources.jar"
    return [origin + relative for origin in ORIGINS]


def fetch_source_url(url):
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Nexus-Android-Source-Review"})
            with urllib.request.urlopen(request, timeout=45) as response:
                require(any(response.url.startswith(origin) for origin in ORIGINS), "Unexpected source redirect origin")
                data = response.read(MAX_ARCHIVE + 1)
            require(len(data) <= MAX_ARCHIVE, "Source archive exceeds bounded review size")
            return data
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(2 ** attempt)
    raise AssertionError("Unreachable source download retry state")


def download_sources(component):
    failures = []
    for url in source_urls(component):
        try:
            data = fetch_source_url(url)
            require(len(data) == component["sourcesBytes"], "Source archive length mismatch")
            require(digest(data) == component["sourcesSha256"], "Source archive SHA256 mismatch")
            return data, url
        except urllib.error.HTTPError as error:
            if error.code not in (404, 410):
                raise
            failures.append(f"HTTP {error.code}")
    raise ValueError(f"Pinned source archive unavailable at fixed origins: {', '.join(failures)}")


def leading_comments(text):
    position = 1 if text.startswith("\ufeff") else 0
    declaration = re.match(r"\s*<\?xml[\s\S]*?\?>", text[position:])
    if declaration:
        position += declaration.end()
    comments = []
    while True:
        match = re.match(r"\s*(/\*[\s\S]*?\*/|//[^\n]*(?:\n|$)|<!--[\s\S]*?-->)", text[position:])
        if not match:
            break
        comments.append(match.group(1))
        position += match.end()
    return "\n".join(comments)


def inspect_sources(data, expected_hash):
    require(len(data) <= MAX_ARCHIVE and digest(data) == expected_hash, "Pinned source bytes mismatch")
    records, names, total = [], set(), 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        require(len(archive.infolist()) <= 100000, "Too many source entries")
        for entry in archive.infolist():
            name = entry.filename
            parts = PurePosixPath(name).parts
            require(not name.startswith("/") and "\\" not in name and ":" not in name
                    and ".." not in parts and name not in names, "Unsafe or duplicate source entry")
            names.add(name)
            if entry.is_dir():
                continue
            total += entry.file_size
            require(entry.file_size <= MAX_ENTRY and total <= MAX_TOTAL, "Source entry/expanded archive exceeds review bound")
            with archive.open(entry) as stream:
                payload = stream.read(MAX_ENTRY + 1)
            require(len(payload) == entry.file_size, "Source entry byte count mismatch")
            item = {"entry": name, "bytes": len(payload), "sha256": digest(payload)}
            try:
                text = payload.decode("utf-8", errors="strict")[:MAX_HEADER]
            except UnicodeDecodeError:
                item.update(textReadable=False, leadingComment="", textWindowTruncated=len(payload) > MAX_HEADER)
            else:
                named = bool(re.fullmatch(r"(?i)(licen[cs]e|notice|copying|copyright)([._-].*)?", PurePosixPath(name).name))
                header = text if named else leading_comments(text)
                item.update(textReadable=True, namedNoticeEntry=named, leadingComment=header,
                            commentSha256=digest(header.encode()), textWindowTruncated=len(payload) > MAX_HEADER,
                            spdxHints=re.findall(r"SPDX-License-Identifier:\s*([^\r\n*<>]+)", header),
                            copyrightHints=[line.strip() for line in header.splitlines()
                                            if re.search(r"(?i)copyright|\(c\)|©", line)])
            records.append(item)
    return sorted(records, key=lambda item: item["entry"])


def collect(report, output, downloader=download_sources):
    output.mkdir(parents=True, exist_ok=True)
    results, complete = [], True
    for component in report["components"]:
        key = component["key"]
        item = {"component": key, "sourceFileLicensingApproved": False}
        if component["kind"] != "module" or not component.get("sourcesResolved"):
            item["finding"] = "Project audit required" if component["kind"] == "project" else "Sources unavailable in original inventory"
        else:
            try:
                data, url = downloader(component)
                require(len(data) == component["sourcesBytes"], "Source archive length mismatch")
                entries = inspect_sources(data, component["sourcesSha256"])
                filename = digest(key.encode()) + ".json"
                evidence = {"component": key, "sourcesSha256": component["sourcesSha256"], "sourceUrl": url,
                            "entries": entries, "sourceFileLicensingApproved": False}
                (output / filename).write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                item.update(report=filename, sourceEntryCount=len(entries),
                            leadingCommentCount=sum(bool(entry["leadingComment"]) for entry in entries))
            except (ValueError, OSError, zipfile.BadZipFile, RuntimeError) as error:
                complete = False
                item["finding"] = str(error)
        results.append(item)
    summary = {"schemaVersion": 1, "inventoryRevision": report["sourceRevision"],
               "reviewerRevision": os.environ.get("GITHUB_SHA"),
               "scope": "Hash-bound source comment evidence, not final DEX retention or accepted license grants",
               "advertisedSourceMaterialsCollected": complete, "components": results,
               "perFileLicenseAuditComplete": False, "runtimeNoticesAndSourceAuditComplete": False,
               "distributable": False}
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def main():
    require(os.environ.get("GITHUB_ACTIONS") == "true", "Source evidence collection is GitHub-only")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--expected-revision", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = read_inventory(args.inventory.read_bytes(), args.expected_revision, args.expected_sha256)
    summary = collect(report, args.output)
    findings = [item for item in summary["components"] if "finding" in item]
    print(f"Source evidence: {len(summary['components'])} components, {len(findings)} explicit material/project findings; legal approval remains false")
    return 0 if summary["advertisedSourceMaterialsCollected"] else 1


if __name__ == "__main__":
    sys.exit(main())
