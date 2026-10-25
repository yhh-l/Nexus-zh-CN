"""Dependency-parser controls and actual SDK zipalign corruption test (GitHub only)."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("apk_audit", Path(__file__).with_name("android-apk-audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class NativePolicy(unittest.TestCase):
    def setUp(self):
        self.dynamic = (
            "Dynamic section at offset 0x100 contains 3 entries:\n"
            "  0x1 (NEEDED) Shared library: [libc.so]\n"
            "  0x1 (NEEDED) Shared library: [libc++_shared.so]\n"
            "  0xe (SONAME) Library soname: [libtempo_lib.so]\n"
        )
        self.bundled = {"libtempo_lib.so", "libc++_shared.so"}
        self.system = {"libc.so", "libm.so", "libdl.so"}

    def check(self, text):
        return audit.dynamic_dependencies(text, "libtempo_lib.so", self.bundled, self.system)

    def test_accept_only_actual_bundled_or_ndk_names(self):
        self.assertEqual(self.check(self.dynamic), ["libc.so", "libc++_shared.so"])
        self.bundled.remove("libc++_shared.so")
        with self.assertRaisesRegex(ValueError, "Unbundled/non-NDK"):
            self.check(self.dynamic)

    def test_reject_desktop_dependencies_and_search_paths(self):
        for library in ["libc.so.6", "libm.so.6", "libstdc++.so.6", "libssl.so.3", "../libc.so", "/host/libc.so"]:
            with self.subTest(library=library):
                with self.assertRaises(ValueError):
                    self.check(self.dynamic.replace("[libc.so]", f"[{library}]"))
        for tag in ["RPATH", "RUNPATH"]:
            with self.subTest(tag=tag):
                with self.assertRaisesRegex(ValueError, "search path"):
                    self.check(self.dynamic + f" 0x1 ({tag}) Library runpath: [/host/lib]\n")

    def test_reject_absent_evidence_or_aliased_soname(self):
        for output in ["", "There is no dynamic section in this file.",
                       "Dynamic section at offset 0x100 contains 0 entries:\n",
                       self.dynamic.replace("[libtempo_lib.so]", "[libforeign.so]")]:
            with self.subTest(output=output):
                with self.assertRaises(ValueError):
                    self.check(output)

    def test_real_sdk_zipalign_accepts_16k_and_rejects_actual_unaligned_zip(self):
        # These ZIP bytes are NONEXECUTABLE fixtures solely for the real SDK tool.
        # No simulated zipalign result; absence/error is a cloud test failure.
        sdk = Path(os.environ["ANDROID_HOME"])
        tool = sdk / "build-tools/36.0.0/zipalign"
        self.assertTrue(tool.is_file(), "Real pinned SDK zipalign is required")
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / "unaligned.apk"
            aligned = Path(directory) / "aligned.apk"
            with zipfile.ZipFile(original, "w", compression=zipfile.ZIP_STORED) as archive:
                archive.writestr("lib/arm64-v8a/fixture.so", b"not-an-executable-library")
                archive.writestr("classes.dex", b"not-executable-dex")
            command = [str(tool), "-c", "-P", "16", "-v", "4"]
            bad = subprocess.run([*command, str(original)], capture_output=True, text=True)
            self.assertNotEqual(bad.returncode, 0, "Negative control must fail alignment")
            subprocess.run([str(tool), "-P", "16", "-f", "4", str(original), str(aligned)],
                           check=True, capture_output=True, text=True)
            good = subprocess.run([*command, str(aligned)], capture_output=True, text=True)
            self.assertEqual(good.returncode, 0, good.stdout + good.stderr)
            # The original must remain rejected, not silently rewritten by validation.
            self.assertNotEqual(subprocess.run([*command, str(original)], capture_output=True).returncode, 0)


class ManifestPolicy(unittest.TestCase):
    # Parser fixtures are not compiled manifests or an installable app.
    BADGING = (
        "package: name='com.kd9taw.tempo' versionCode='1' versionName='1.20.0'\n"
        "sdkVersion:'35'\ntargetSdkVersion:'36'\n"
        "uses-permission: name='android.permission.INTERNET'\n"
        "uses-permission: name='android.permission.RECORD_AUDIO'\n"
        "launchable-activity: name='com.kd9taw.tempo.NexusLaunchActivity' label='Nexus' icon=''\n"
        "native-code: 'arm64-v8a'\n"
    )

    def test_accept_expected_native_host_core_without_claiming_full_manifest_audit(self):
        result = audit.manifest_core(self.BADGING)
        self.assertEqual(result["package"], "com.kd9taw.tempo")
        self.assertEqual(result["minSdk"], 35)
        self.assertEqual(result["targetSdk"], 36)
        self.assertEqual(result["abis"], ["arm64-v8a"])
        self.assertFalse(result["debuggable"])
        self.assertFalse(result["fullComponentSecurityAuditComplete"])

    def test_reject_changed_package_sdk_launcher_abi_or_network_permission(self):
        for before, after in [("name='com.kd9taw.tempo'", "name='foreign.app'"),
                              ("sdkVersion:'35'", "sdkVersion:'24'"),
                              ("targetSdkVersion:'36'", "targetSdkVersion:'35'"),
                              (".NexusLaunchActivity'", ".ForeignActivity'"),
                              ("native-code: 'arm64-v8a'", "native-code: 'arm64-v8a' 'x86_64'"),
                              ("android.permission.INTERNET", "android.permission.FOREIGN")]:
            with self.subTest(before=before):
                with self.assertRaises(ValueError):
                    audit.manifest_core(self.BADGING.replace(before, after))
        with self.assertRaises(ValueError):
            audit.manifest_core(self.BADGING + "application-debuggable\n")

    def test_reject_missing_or_duplicate_manifest_evidence(self):
        for line in self.BADGING.splitlines(keepends=True):
            with self.subTest(line=line):
                with self.assertRaises(ValueError):
                    audit.manifest_core(self.BADGING.replace(line, ""))
                if not line.startswith("uses-permission:"):
                    with self.assertRaises(ValueError):
                        audit.manifest_core(self.BADGING + line)


class MergedManifestPolicy(unittest.TestCase):
    # Nonexecuting fixtures: no DEX, native engine, runtime or install evidence.
    def fixture(self):
        policy = (audit.ROOT / "src-tauri/src/android_panels/policy.rs").read_text()
        panels = audit.re.findall(r'\("[^"\n]+", "([A-Za-z0-9]+PanelActivity)"\)', policy)
        self.assertEqual(len(panels), 17)
        private = ''.join(f'<activity android:name=".{name}" android:exported="false" />' for name in panels)
        return ('<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.kd9taw.tempo">'
                '<application android:debuggable="false">'
                '<activity android:name=".MainActivity" android:exported="false" android:launchMode="singleTask" />'
                '<activity android:name=".NexusUsbLaunchActivity" android:exported="false" android:launchMode="singleTask" />'
                '<activity android:name=".NexusLaunchActivity" android:exported="true"><intent-filter>'
                '<action android:name="android.intent.action.MAIN" />'
                '<category android:name="android.intent.category.LAUNCHER" />'
                '</intent-filter></activity>' + private + '</application></manifest>')

    def test_accept_required_private_inventory_and_exact_protected_androidx_entry(self):
        result = audit.merged_manifest_components(self.fixture())
        self.assertEqual(result["privateNativeActivityCount"], 19)
        self.assertEqual(len(result["components"]), 20)
        self.assertTrue(result["mergedManifestComponentExposureVerified"])
        self.assertFalse(result["fullComponentSecurityAuditComplete"])
        audit.merged_manifest_components(self.fixture().replace('android:launchMode="singleTask"', 'android:launchMode="2"'))
        protected = ('<receiver android:name="androidx.profileinstaller.ProfileInstallReceiver" '
                     'android:exported="true" android:permission="android.permission.DUMP" />')
        audit.merged_manifest_components(self.fixture().replace('</application>', protected + '</application>'))
        for bad in [protected.replace('android.permission.DUMP', 'android.permission.INTERNET'),
                    protected.replace('androidx.profileinstaller.ProfileInstallReceiver', 'foreign.Receiver')]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                audit.merged_manifest_components(self.fixture().replace('</application>', bad + '</application>'))

    def test_reject_private_export_alias_missing_duplicate_or_unresolved_component(self):
        good = self.fixture()
        private = '<activity android:name=".WaterfallPanelActivity" android:exported="false" />'
        for changed in [private.replace('"false"', '"true"'),
                        private.replace('"false"', '"@bool/exposed"'),
                        private.replace('activity ', 'activity-alias '), '', private + private,
                        private.replace('/>', '><intent-filter /></activity>'),
                        private.replace('/>', 'android:enabled="false" />')]:
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                audit.merged_manifest_components(good.replace(private, changed))
        for kind in ['activity', 'activity-alias', 'service', 'receiver', 'provider']:
            extra = f'<{kind} android:name="foreign.Entry" android:exported="true" />'
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                audit.merged_manifest_components(good.replace('</application>', extra + '</application>'))
        # Private third-party initialization components are recorded, not misreported as exported.
        provider = '<provider android:name="foreign.Initializer" android:authorities="com.kd9taw.tempo.init" />'
        result = audit.merged_manifest_components(good.replace('</application>', provider + '</application>'))
        self.assertFalse(result['components'][-1]['exported'])

    def test_reject_release_policy_instrumentation_or_external_launcher_changes(self):
        good = self.fixture()
        for before, after in [
            ('android:debuggable="false"', 'android:debuggable="true"'),
            ('android:debuggable="false"', 'android:testOnly="true"'),
            ('android:debuggable="false"', 'android:enabled="false"'),
            ('android:debuggable="false"', 'android:permission="foreign.permission"'),
            ('android.intent.action.MAIN', 'android.intent.action.VIEW'),
            ('android.intent.category.LAUNCHER', 'android.intent.category.BROWSABLE'),
            ('</intent-filter>', '<data android:scheme="nexus" /></intent-filter>'),
            ('</manifest>', '<instrumentation android:name="foreign.Test" /></manifest>'),
            ('android:name=".NexusLaunchActivity" android:exported="true"',
             'android:name=".NexusLaunchActivity" android:exported="false"'),
            ('android:launchMode="singleTask"', 'android:launchMode="standard"'),
        ]:
            with self.subTest(before=before), self.assertRaises(ValueError):
                audit.merged_manifest_components(good.replace(before, after))

    def test_actual_sdk_decodes_compiled_manifest_and_rejects_same_apk_export_corruption(self):
        sdk = Path(os.environ['ANDROID_HOME'])
        aapt = sdk / 'build-tools/36.0.0/aapt2'
        framework = sdk / 'platforms/android-36/android.jar'
        self.assertTrue(aapt.is_file(), 'Actual pinned aapt2 required')
        self.assertTrue(framework.is_file(), 'Actual API 36 resources required')
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'AndroidManifest.xml'
            apk = Path(directory) / 'nonexecuting-manifest-fixture.apk'
            command = [str(aapt), 'link', '-I', str(framework), '--manifest', str(source),
                       '--min-sdk-version', '35', '--target-sdk-version', '36', '-o', str(apk)]
            source.write_text(self.fixture())
            audit.run(command)
            original = apk.read_bytes()
            decoded = audit.run([str(sdk / "cmdline-tools/latest/bin/apkanalyzer"), "manifest", "print", str(apk)])
            print("Actual SDK-decoded nonexecuting binary Manifest fixture:", decoded)
            result = audit.compiled_manifest(apk, sdk)
            self.assertEqual(result['privateNativeActivityCount'], 19)
            self.assertTrue(result['decoder']['sdkSourceProperties'])
            # Mutate the binary Manifest that the real decoder will read at the SAME path.
            source.write_text(self.fixture().replace(
                'android:name=".NexusUsbLaunchActivity" android:exported="false"',
                'android:name=".NexusUsbLaunchActivity" android:exported="true"'))
            apk.unlink()
            audit.run(command)
            self.assertNotEqual(apk.read_bytes(), original)
            with self.assertRaisesRegex(ValueError, 'no longer private'):
                audit.compiled_manifest(apk, sdk)

if __name__ == "__main__":
    unittest.main()
