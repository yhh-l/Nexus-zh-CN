"""Cloud-only approval/privacy controls and real SDK test signing (not device proof)."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("test_signer", Path(__file__).with_name("android-test-apk.py"))
signer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signer)


class Policy(unittest.TestCase):
    def test_actual_approval_context_is_closed_by_default(self):
        good = {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch",
                "GITHUB_REF": "refs/heads/codex/android-arm64", "NEXUS_ANDROID_TEST_APK": "true",
                "GITHUB_SHA": "a" * 40}
        signer.require_context(good)
        for key in good:
            with self.subTest(key=key), self.assertRaises(ValueError):
                signer.require_context({**good, key: ""})
        for change in ({"GITHUB_EVENT_NAME": "push"}, {"GITHUB_REF": "refs/heads/main"},
                       {"NEXUS_ANDROID_TEST_APK": "false"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                signer.require_context({**good, **change})

    def test_actual_workflow_exports_only_explicit_manual_test_outputs(self):
        workflow = (signer.ROOT / ".github/workflows/android-arm64.yml").read_text()
        self.assertIn("        default: false", workflow)
        gate = "if: github.event_name == 'workflow_dispatch' && inputs.test_apk"
        self.assertEqual(workflow.count(gate), 2)
        self.assertIn("    needs: [portable-libraries, ui-mobile, browser-layout]", workflow)
        upload = workflow.split("- name: Upload signed INTERNAL TEST APK", 1)[1]
        self.assertIn(gate, upload)
        for name in ("Nexus-Android-ARM64-test.apk", "test-signing-report.json", "SHA256SUMS.txt", "READ-ME-FIRST.txt"):
            self.assertIn("target/android-test-apk/" + name, upload)
        for unsafe in ("RUNNER_TEMP", "*.p12", "*.jks", "secrets.", "contents: write"):
            self.assertNotIn(unsafe, upload)

    def test_prerelease_never_consumes_public_version(self):
        self.assertEqual(signer.version_config("1.20.0", "12"), {"version": "1.20.0-android-test.12"})
        for base, run in (("1.20.0-test", "12"), ("1.20", "1"), ("1.20.0", "0"), ("1.20.0", "x")):
            with self.subTest(base=base, run=run), self.assertRaises(ValueError):
                signer.version_config(base, run)

    def test_actual_verification_requires_two_schemes_and_exactly_one_signer(self):
        output = ("Verified using v2 scheme (APK Signature Scheme v2): true\n"
                  "Verified using v3 scheme (APK Signature Scheme v3): true\n"
                  "Signer #1 certificate SHA-256 digest: " + "a" * 64 + "\n")
        self.assertEqual(signer.signature_evidence(output), "a" * 64)
        for bad in ("", output.replace(": true", ": false", 1),
                    output + "Signer #2 certificate SHA-256 digest: " + "b" * 64 + "\n"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                signer.signature_evidence(bad)

    def test_failed_tools_do_not_echo_their_arguments_or_output(self):
        with self.assertRaises(ValueError) as failure:
            signer.run_private(["/bin/sh", "-c", "echo PRIVATE_FIXTURE >&2; exit 7"], os.environ)
        self.assertNotIn("PRIVATE_FIXTURE", str(failure.exception))
        self.assertIn("exit 7", str(failure.exception))


@unittest.skipUnless(os.environ.get("GITHUB_ACTIONS") == "true", "Real tools run on GitHub only")
class ActualSdk(unittest.TestCase):
    def test_real_signing_and_same_apk_corruption_with_private_key_cleanup(self):
        sdk = Path(os.environ["ANDROID_HOME"])
        java = Path(os.environ.get("JAVA_HOME_17_X64", os.environ["JAVA_HOME"]))
        with tempfile.TemporaryDirectory(dir=os.environ["RUNNER_TEMP"]) as directory:
            root = Path(directory)
            manifest = root / "AndroidManifest.xml"
            manifest.write_text('<manifest xmlns:android="http://schemas.android.com/apk/res/android" '
                                'package="org.nexus.testfixture" android:versionCode="1" '
                                'android:versionName="1.0.0-test"><uses-sdk android:minSdkVersion="35"/>'
                                '<application android:hasCode="false"/></manifest>')
            unsigned, signed = root / "unsigned.apk", root / "signed.apk"
            signer.run_private([sdk / "build-tools/36.0.0/aapt2", "link", "-o", unsigned,
                                "--manifest", manifest, "-I", sdk / "platforms/android-36/android.jar"], os.environ)
            certificate = signer.sign_apk(unsigned, signed, sdk, java, root)
            self.assertEqual(len(certificate), 64)
            self.assertFalse(list(root.glob("nexus-test-signing-*")))
            self.assertNotIn("NEXUS_TEST_STOREPASS", os.environ)
            # Change the SAME successfully verified APK's payload, not a fake command.
            with zipfile.ZipFile(signed, "a") as archive:
                archive.writestr("assets/corrupt.txt", b"changed after signing")
            with self.assertRaises(ValueError):
                signer.run_private([sdk / "build-tools/36.0.0/apksigner", "verify", signed], os.environ)
            with self.assertRaises(ValueError):
                signer.sign_apk(root / "missing.apk", root / "missing-signed.apk", sdk, java, root)
            self.assertFalse(list(root.glob("nexus-test-signing-*")))


if __name__ == "__main__":
    unittest.main()
