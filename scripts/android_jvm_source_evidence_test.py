"""Original source-material controls; no Android or license acceptance claims."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

spec = importlib.util.spec_from_file_location("source_evidence", Path(__file__).with_name("android-jvm-source-evidence.py"))
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


def archive(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as container:
        for name, data in entries:
            container.writestr(name, data)
    return output.getvalue()


class SourceEvidence(unittest.TestCase):
    def fixture(self):
        data = archive([("example/Original.kt", "/* Copyright original fixture authors\n * SPDX-License-Identifier: Apache-2.0\n */\npackage example\n"),
                        ("META-INF/LICENSE.txt", "Original notice fixture; not a third-party grant.\n"),
                        ("example/NoHeader.java", "package example; // SPDX-License-Identifier: not-a-leading-grant\n")])
        return data, evidence.digest(data)

    def inventory(self, data, digest):
        return {"sourceRevision": "a" * 40, "syntheticFixture": False, "runtimeInputResolutionComplete": True,
                "artifactSelection": "android-aar-or-jar", "components": [
                    {"kind": "project", "key": "project :app"},
                    {"kind": "module", "key": "fixture:alpha:1.0", "group": "fixture", "module": "alpha",
                     "version": "1.0", "sourcesResolved": True, "sourcesBytes": len(data), "sourcesSha256": digest}]}

    def test_original_source_hashes_and_leading_comments_do_not_approve_licenses(self):
        data, digest = self.fixture()
        items = {item["entry"]: item for item in evidence.inspect_sources(data, digest)}
        self.assertEqual(items["example/Original.kt"]["spdxHints"], ["Apache-2.0"])
        self.assertIn("Copyright original fixture authors", items["example/Original.kt"]["leadingComment"])
        self.assertEqual(items["example/NoHeader.java"]["leadingComment"], "")
        self.assertEqual(items["example/NoHeader.java"]["spdxHints"], [])
        self.assertTrue(items["META-INF/LICENSE.txt"]["namedNoticeEntry"])
        self.assertEqual(items["example/Original.kt"]["commentSha256"],
                         evidence.digest(items["example/Original.kt"]["leadingComment"].encode()))
        with tempfile.TemporaryDirectory() as directory:
            summary = evidence.collect(self.inventory(data, digest), Path(directory), lambda _: (data, "original-fixture"))
            self.assertTrue(summary["advertisedSourceMaterialsCollected"])
            self.assertFalse(summary["perFileLicenseAuditComplete"])
            self.assertFalse(summary["runtimeNoticesAndSourceAuditComplete"])
            self.assertFalse(summary["distributable"])
            self.assertIn("Project audit required", summary["components"][0]["finding"])
            report = json.loads((Path(directory) / summary["components"][1]["report"]).read_text())
            self.assertEqual(report["sourcesSha256"], digest)
            self.assertFalse(report["sourceFileLicensingApproved"])
            self.assertEqual(len(report["entries"]), 3)

    def test_component_prefixed_notices_preserve_full_text_without_accepting_grants(self):
        names = ["META-INF/fixture-core-LICENSE", "META-INF/fixture-core-NOTICE",
                 "META-INF/fixture.COPYING.txt", "META-INF/fixture_copyright"]
        text = "Original synthetic fixture notice, not a license grant.\nSecond notice line.\n"
        data = archive([(name, text) for name in names] +
                       [("example/LicenseHelper.java", "package example;\n"),
                        ("example/MyNotice.kt", "package example\n")])
        entries = {item["entry"]: item for item in evidence.inspect_sources(data, evidence.digest(data))}
        for name in names:
            with self.subTest(name=name):
                self.assertTrue(entries[name]["namedNoticeEntry"])
                self.assertEqual(entries[name]["leadingComment"], text)
                self.assertEqual(entries[name]["commentSha256"], evidence.digest(text.encode()))
        for name in ("example/LicenseHelper.java", "example/MyNotice.kt"):
            self.assertFalse(entries[name]["namedNoticeEntry"])
            self.assertEqual(entries[name]["leadingComment"], "")
        with tempfile.TemporaryDirectory() as directory:
            summary = evidence.collect(self.inventory(data, evidence.digest(data)), Path(directory),
                                       lambda _: (data, "original-fixture"))
            self.assertTrue(summary["advertisedSourceMaterialsCollected"])
            self.assertFalse(summary["perFileLicenseAuditComplete"])
            self.assertFalse(summary["distributable"])

    def test_exact_inventory_bytes_revision_and_actual_scope_are_required(self):
        data, digest = self.fixture()
        report = self.inventory(data, digest)
        payload = json.dumps(report).encode()
        self.assertEqual(evidence.read_inventory(payload, "a" * 40, evidence.digest(payload)), report)
        for changed, message in [(payload + b" ", "SHA256"), (payload, "revision")]:
            revision = "a" * 40 if changed != payload else "b" * 40
            with self.assertRaisesRegex(ValueError, message):
                evidence.read_inventory(changed, revision, evidence.digest(payload))
        for key, value in [("syntheticFixture", True), ("runtimeInputResolutionComplete", False),
                           ("artifactSelection", "jar")]:
            changed = json.dumps({**report, key: value}).encode()
            with self.assertRaises(ValueError):
                evidence.read_inventory(changed, "a" * 40, evidence.digest(changed))

    def test_wrong_source_bytes_or_recorded_length_cannot_produce_complete_materials(self):
        data, digest = self.fixture()
        with self.assertRaisesRegex(ValueError, "Pinned source"):
            evidence.inspect_sources(data + b"tampered", digest)
        with tempfile.TemporaryDirectory() as directory:
            summary = evidence.collect(self.inventory(data, digest), Path(directory), lambda _: (data + b"bad", "fixture"))
            self.assertFalse(summary["advertisedSourceMaterialsCollected"])
            self.assertIn("length mismatch", summary["components"][1]["finding"])

    def test_unsafe_duplicate_and_oversized_archive_entries_are_refused_without_extraction(self):
        for name in ("../escape.java", "/absolute.java", "folder\\escape.java", "C:escape.java"):
            data = archive([(name, "// original fixture")])
            with self.assertRaisesRegex(ValueError, "Unsafe"):
                evidence.inspect_sources(data, evidence.digest(data))
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            data = archive([("same.java", "one"), ("same.java", "two")])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            evidence.inspect_sources(data, evidence.digest(data))
        data, digest = self.fixture()
        with patch.object(evidence, "MAX_ENTRY", 4), self.assertRaisesRegex(ValueError, "review bound"):
            evidence.inspect_sources(data, digest)

    def test_non_utf8_and_nonleading_hints_remain_explicit_not_invented(self):
        data = archive([("binary.dat", b"\xff\x00"), ("Original.xml", '<?xml version="1.0"?>\n<!-- Copyright original fixture -->\n<resource/>')])
        items = {item["entry"]: item for item in evidence.inspect_sources(data, evidence.digest(data))}
        self.assertFalse(items["binary.dat"]["textReadable"])
        self.assertIn("Copyright original fixture", items["Original.xml"]["leadingComment"])
        self.assertNotIn("<resource", items["Original.xml"]["leadingComment"])

    def test_actual_downloader_retries_transient_errors_but_refuses_wrong_bytes(self):
        data, digest = self.fixture()
        component = self.inventory(data, digest)["components"][1]
        url = evidence.source_urls(component)[0]
        stream = io.BytesIO(data)
        stream.url = url
        error = evidence.urllib.error.HTTPError(url, 503, "Original transient fixture", {}, None)
        with patch.object(evidence.urllib.request, "urlopen", side_effect=[error, stream]) as opening, patch.object(evidence.time, "sleep"):
            payload, actual = evidence.download_sources(component)
            self.assertEqual(payload, data)
            self.assertEqual(actual, url)
            self.assertEqual(opening.call_count, 2)
        stream = io.BytesIO(data)
        stream.url = url
        with patch.object(evidence.urllib.request, "urlopen", return_value=stream), self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
            evidence.download_sources({**component, "sourcesSha256": "0" * 64})

    def test_maven_origins_are_fixed_and_component_identity_cannot_inject_a_url(self):
        data, digest = self.fixture()
        component = self.inventory(data, digest)["components"][1]
        self.assertEqual(evidence.source_urls(component), [origin + "fixture/alpha/1.0/alpha-1.0-sources.jar" for origin in evidence.ORIGINS])
        for value in ("../escape", "https://example.invalid", "group..name", "group?token=x"):
            with self.assertRaises(ValueError):
                evidence.source_urls({**component, "group": value})
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            evidence.source_urls({**component, "key": "other:module:2.0"})


if __name__ == "__main__":
    unittest.main()
