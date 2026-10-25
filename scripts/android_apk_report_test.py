"""Exercise the actual container verifier on disposable ZIP fixtures, cloud-only.
These tiny headers are deliberately NOT runnable DEX/ELF or a substitute decoder.
They test rejection boundaries; real packaging must supply real product bytes.
"""
import hashlib
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

spec = importlib.util.spec_from_file_location("apk_report", Path(__file__).with_name("android-apk-report.py"))
reporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reporter)
MODEL = b"synthetic-unit-test-model-not-product"


class ContainerPolicy(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.apk = Path(self.directory.name) / "fixture.apk"
        header = bytearray(64)
        header[:7] = b"\x7fELF\x02\x01\x01"
        struct.pack_into("<HHI", header, 16, 3, 183, 1)
        self.members = {
            "AndroidManifest.xml": b"synthetic-manifest",
            "classes.dex": b"dex\n035\0synthetic-not-executable",
            "lib/arm64-v8a/libtempo_lib.so": bytes(header),
            "assets/resources/deepcw/model.onnx": MODEL,
        }
        self.hash_patch = patch.object(reporter, "MODEL_SHA256", hashlib.sha256(MODEL).hexdigest())
        self.hash_patch.start()
        self.addCleanup(self.hash_patch.stop)

    def write(self, members=None):
        with zipfile.ZipFile(self.apk, "w") as archive:
            for name, content in (members or self.members).items():
                archive.writestr(name, content)

    def test_actual_zip_hashes_and_incomplete_acceptance_flags(self):
        self.write()
        result = reporter.inspect(self.apk)
        self.assertEqual(result["sha256"], hashlib.sha256(self.apk.read_bytes()).hexdigest())
        self.assertTrue(result["apkProduced"])
        for key in ("signatureVerified", "installableVerified", "fullPayloadAuditComplete",
                    "elfAndZip16KiBVerified", "runtimeNoticesAndSourceAuditComplete", "deviceTested", "distributable"):
            self.assertIs(result[key], False)

    def test_missing_required_actual_members(self):
        for name in list(self.members):
            with self.subTest(name=name):
                self.write({key: value for key, value in self.members.items() if key != name})
                with self.assertRaises(ValueError):
                    reporter.inspect(self.apk)

    def test_reject_changed_model_and_non_dex(self):
        for name, replacement in [("assets/resources/deepcw/model.onnx", MODEL + b"changed"),
                                  ("classes.dex", b"not a DEX")]:
            with self.subTest(name=name):
                self.write({**self.members, name: replacement})
                with self.assertRaises(ValueError):
                    reporter.inspect(self.apk)

    def test_reject_foreign_and_disguised_native_payloads(self):
        native = self.members["lib/arm64-v8a/libtempo_lib.so"]
        for name, content in [("lib/x86_64/foreign.so", native), ("assets/native.asset", native),
                              ("assets/windows.asset", b"MZforeign"), ("assets/rigctld.exe", b"text"),
                              ("lib/arm64-v8a/foreign.dll", native), ("assets/build.a", b"archive")]:
            with self.subTest(name=name):
                self.write({**self.members, name: content})
                with self.assertRaises(ValueError):
                    reporter.inspect(self.apk)

    def test_reject_wrong_architecture_or_truncated_elf(self):
        native = bytearray(self.members["lib/arm64-v8a/libtempo_lib.so"])
        struct.pack_into("<H", native, 18, 62)
        for bad in (bytes(native), b"\x7fELF", b"text"):
            with self.subTest(bad=bad[:8]):
                self.write({**self.members, "lib/arm64-v8a/libtempo_lib.so": bad})
                with self.assertRaises(ValueError):
                    reporter.inspect(self.apk)

    def test_reject_traversal_and_duplicate_entries(self):
        self.write({**self.members, "../outside": b"no"})
        with self.assertRaises(ValueError):
            reporter.inspect(self.apk)
        self.write()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(self.apk, "a") as archive:
                archive.writestr("classes.dex", b"dex\n035\0duplicate")
        with self.assertRaises(ValueError):
            reporter.inspect(self.apk)

    def test_reject_missing_or_non_zip_output(self):
        with self.assertRaises(ValueError):
            reporter.inspect(self.apk)
        self.apk.write_bytes(b"not a zip")
        with self.assertRaises(zipfile.BadZipFile):
            reporter.inspect(self.apk)


if __name__ == "__main__":
    unittest.main()