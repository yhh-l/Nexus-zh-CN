"""Synthetic notice-delivery controls; the real APK is checked in the full cloud build."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location("apk_notices", Path(__file__).with_name("android-apk-notices.py"))
notices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notices)


class RustNoticeDelivery(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.revision = "a" * 40
        self.text = "Target notice fixture — non-ASCII bytes\n".encode()
        self.project_notice = "Original project NOTICE fixture — not a third-party grant.\n".encode()
        (self.root / "NOTICE").write_bytes(self.project_notice)
        self.directory = self.root / "target/android-notices"
        self.directory.mkdir(parents=True)
        self.frontend = self.root / "ui/dist/rust/THIRD-PARTY.txt"
        self.frontend.parent.mkdir(parents=True)
        self.frontend.write_bytes(self.text)
        (self.directory / "RUST-THIRD-PARTY.txt").write_bytes(self.text)
        self.report = {"schemaVersion": 1, "sourceRevision": self.revision,
                       "target": "aarch64-linux-android", "features": notices.FEATURES,
                       "rustNoticeGenerationComplete": True, "problems": [],
                       "noticeBytes": len(self.text), "noticeSha256": hashlib.sha256(self.text).hexdigest()}
        self.save()
        self.apk = self.root / "fixture-not-real-app.apk"
        with zipfile.ZipFile(self.apk, "w") as archive:
            archive.writestr(notices.MEMBER, self.text)
            archive.writestr(notices.PROJECT_NOTICE_MEMBER, self.project_notice)

    def save(self):
        (self.directory / "rust-report.json").write_text(json.dumps(self.report))

    def test_exact_frontend_and_archive_bytes_are_distinct_evidence(self):
        result = notices.inspect_frontend(self.root, self.revision)
        self.assertTrue(result["frontendRustNoticeEmissionVerified"])
        self.assertFalse(result["androidRustResourcePayloadVerified"])
        self.assertFalse(result["androidProjectNoticePayloadVerified"])
        result = notices.inspect_apk(self.apk, self.root, self.revision)
        self.assertTrue(result["androidRustResourcePayloadVerified"])
        self.assertTrue(result["androidProjectNoticePayloadVerified"])
        self.assertEqual(result["projectNoticeSha256"], hashlib.sha256(self.project_notice).hexdigest())
        for flag in ("runtimeDisplayVerified", "runtimeNoticesAndSourceAuditComplete", "distributable"):
            self.assertFalse(result[flag])

    def test_wrong_revision_target_graph_and_incomplete_reports_refused(self):
        original = self.report.copy()
        for change in ({"sourceRevision": "b" * 40}, {"target": "windows"}, {"features": ["radio"]},
                       {"rustNoticeGenerationComplete": False}, {"problems": ["missing"]},
                       {"noticeBytes": 1}, {"noticeSha256": "0" * 64}):
            self.report = {**original, **change}
            self.save()
            with self.subTest(change=change), self.assertRaises(ValueError):
                notices.inspect_apk(self.apk, self.root, self.revision)
        with self.assertRaises(ValueError):
            notices.inventory(self.root, "")

    def test_frontend_cannot_silently_deliver_desktop_text(self):
        self.frontend.write_bytes(b"desktop fixture\n")
        with self.assertRaisesRegex(ValueError, "frontend Rust notice asset"):
            notices.inspect_apk(self.apk, self.root, self.revision)

    def test_resource_substitution_missing_and_duplicates_refused(self):
        for entries in ([], [(notices.MEMBER, b"desktop fixture\n")],
                        [(notices.MEMBER, self.text), (notices.MEMBER, self.text)]):
            with warnings.catch_warnings(), zipfile.ZipFile(self.apk, "w") as archive:
                warnings.simplefilter("ignore", UserWarning)
                for name, text in entries:
                    archive.writestr(name, text)
            with self.subTest(count=len(entries)), self.assertRaises(ValueError):
                notices.inspect_apk(self.apk, self.root, self.revision)

    def test_project_notice_missing_substituted_duplicate_and_empty_are_refused(self):
        for entries in ([], [(notices.PROJECT_NOTICE_MEMBER, b"old notice\n")],
                        [(notices.PROJECT_NOTICE_MEMBER, self.project_notice)] * 2):
            with warnings.catch_warnings(), zipfile.ZipFile(self.apk, "w") as archive:
                warnings.simplefilter("ignore", UserWarning)
                archive.writestr(notices.MEMBER, self.text)
                for name, payload in entries:
                    archive.writestr(name, payload)
            with self.subTest(entries=entries), self.assertRaisesRegex(ValueError, "project NOTICE"):
                notices.inspect_apk(self.apk, self.root, self.revision)
        (self.root / "NOTICE").write_bytes(b"")
        with self.assertRaisesRegex(ValueError, "Empty project NOTICE input"):
            notices.inspect_apk(self.apk, self.root, self.revision)

    def test_changed_project_notice_requires_the_actual_apk_to_match(self):
        (self.root / "NOTICE").write_bytes(self.project_notice + b"New original attribution.\n")
        with self.assertRaisesRegex(ValueError, "project NOTICE bytes differ"):
            notices.inspect_apk(self.apk, self.root, self.revision)

    def test_changed_generated_notice_still_rejected_even_with_matching_deliveries(self):
        (self.directory / "RUST-THIRD-PARTY.txt").write_bytes(b"changed\n")
        self.frontend.write_bytes(b"changed\n")
        with zipfile.ZipFile(self.apk, "w") as archive:
            archive.writestr(notices.MEMBER, b"changed\n")
        with self.assertRaisesRegex(ValueError, "inventory"):
            notices.inspect_apk(self.apk, self.root, self.revision)


if __name__ == "__main__":
    unittest.main()
