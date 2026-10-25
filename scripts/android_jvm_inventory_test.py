"""Cloud-only controls execute the real pinned Gradle on entirely synthetic local modules.

These are resolver/collector tests, NOT Android app or third-party license acceptance.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent.parent
COLLECTOR = ROOT / "scripts/android-jvm-inventory.gradle"


@unittest.skipUnless(os.environ.get("GITHUB_ACTIONS") == "true", "Gradle execution is GitHub-only")
class GradleRuntimeInventory(unittest.TestCase):
    def fixture(self, directory, missing=False):
        root = Path(directory)
        (root / "settings.gradle").write_text("rootProject.name = 'synthetic-inventory'\ninclude ':app', ':bridge'\n")
        (root / "app").mkdir()
        (root / "app/build.gradle").write_text("""
repositories { maven { url = uri(rootProject.file('repo')) } }
configurations { universalReleaseRuntimeClasspath }
dependencies {
    universalReleaseRuntimeClasspath 'fixture:alpha:1.0'
    universalReleaseRuntimeClasspath project(':bridge')
}
""")
        (root / "bridge").mkdir()
        (root / "bridge/build.gradle").write_text("""
configurations.create('default')
artifacts { add('default', file('bridge.jar')) }
""")
        with zipfile.ZipFile(root / "bridge/bridge.jar", "w") as archive:
            archive.writestr("fixture.txt", "synthetic local project artifact, not compiled code")
        for module in ("alpha", "beta"):
            folder = root / "repo/fixture" / module / "1.0"
            folder.mkdir(parents=True)
            dependencies = ("<dependencies><dependency><groupId>fixture</groupId><artifactId>beta</artifactId>"
                            "<version>1.0</version></dependency></dependencies>" if module == "alpha" else "")
            (folder / f"{module}-1.0.pom").write_text(
                '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>'
                f'<groupId>fixture</groupId><artifactId>{module}</artifactId><version>1.0</version>'
                '<licenses><license><name>Fixture metadata only; not legal acceptance</name></license></licenses>'
                f'{dependencies}</project>')
            if not (missing and module == "beta"):
                with zipfile.ZipFile(folder / f"{module}-1.0.jar", "w") as archive:
                    archive.writestr("fixture.txt", f"synthetic {module} jar, not compiled code")
            if module == "alpha":
                with zipfile.ZipFile(folder / f"{module}-1.0-sources.jar", "w") as archive:
                    archive.writestr("LICENSE.txt", "Synthetic fixture notice, not a third-party license grant.\n")
                    archive.writestr("fixture/Example.java", "// Synthetic fixture; no production implementation.\n")
        return root

    def invoke(self, root, mode="fixture", extra_tasks=()):
        process = subprocess.run([
            os.environ["NEXUS_TEST_GRADLE"], "--offline", "--no-daemon", "--console=plain", "--max-workers=2",
            "--gradle-user-home", str(root / "gradle-cache"), "--init-script", str(COLLECTOR),
            ":app:nexusAndroidRuntimeInventory", f"-PnexusInventoryMode={mode}",
            "-PnexusInventoryReport=report/runtime-inventory.json", *extra_tasks],
            cwd=root, capture_output=True, text=True, timeout=240)
        report = root / "report/runtime-inventory.json"
        return process, json.loads(report.read_text()) if report.exists() else None

    def test_component_prefixed_notice_entries_are_hashed_by_actual_gradle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            entries = {"META-INF/fixture-core-LICENSE": b"Original synthetic license-name fixture.\n",
                       "META-INF/fixture-core-NOTICE": b"Original synthetic notice-name fixture.\n",
                       "META-INF/fixture.COPYING.txt": b"Original synthetic copying-name fixture.\n",
                       "META-INF/fixture_copyright": b"Original synthetic copyright-name fixture.\n"}
            sources = root / "repo/fixture/alpha/1.0/alpha-1.0-sources.jar"
            with zipfile.ZipFile(sources, "w") as archive:
                for name, payload in entries.items():
                    archive.writestr(name, payload)
                archive.writestr("example/LicenseHelper.java", "package example;\n")
                archive.writestr("example/MyNotice.kt", "package example\n")
            process, report = self.invoke(root)
            self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
            component = next(item for item in report["components"] if item["key"] == "fixture:alpha:1.0")
            records = {item["entry"]: item for item in component["licenseNamedSourceEntries"]}
            self.assertEqual(set(records), set(entries))
            for name, payload in entries.items():
                self.assertTrue(records[name]["textHashed"])
                self.assertEqual(records[name]["bytes"], len(payload))
                self.assertEqual(records[name]["sha256"], hashlib.sha256(payload).hexdigest())
            self.assertEqual(component["sourcesSha256"], hashlib.sha256(sources.read_bytes()).hexdigest())
            self.assertFalse(any(item.startswith("fixture:alpha:1.0:") for item in report["findings"]))
            self.assertFalse(report["perFileLicenseAuditComplete"])
            self.assertFalse(report["distributable"])

    def test_actual_pinned_gradle_records_transitive_project_pom_sources_and_explicit_gaps(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            process, report = self.invoke(root)
            self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
            self.assertIsNotNone(report)
            self.assertTrue(report["syntheticFixture"])
            self.assertTrue(report["runtimeInputResolutionComplete"])
            self.assertEqual(report["gradleVersion"], "8.14.3")
            self.assertEqual(report["configuration"], "universalReleaseRuntimeClasspath")
            self.assertEqual(report["sourceRevision"], os.environ["GITHUB_SHA"])
            components = {component["key"]: component for component in report["components"]}
            self.assertIn("project :bridge", components)
            self.assertTrue(components["fixture:alpha:1.0"]["pomResolved"])
            self.assertTrue(components["fixture:alpha:1.0"]["sourcesResolved"])
            self.assertFalse(components["fixture:beta:1.0"]["sourcesResolved"])
            self.assertEqual(components["fixture:alpha:1.0"]["licenseNamedSourceEntries"][0]["entry"], "LICENSE.txt")
            self.assertIn({"from": "fixture:alpha:1.0", "to": "fixture:beta:1.0"}, report["dependencyEdges"])
            for artifact in report["artifacts"]:
                if artifact["component"] == "fixture:alpha:1.0":
                    file = root / "repo/fixture/alpha/1.0/alpha-1.0.jar"
                    self.assertEqual(artifact["sha256"], hashlib.sha256(file.read_bytes()).hexdigest())
            self.assertTrue(any("fixture:beta:1.0: source artifact unavailable" in finding for finding in report["findings"]))
            for flag in ("apkPayloadVerified", "perFileLicenseAuditComplete", "runtimeNoticesAndSourceAuditComplete", "distributable"):
                self.assertFalse(report[flag])

    def test_buildsrc_initialization_cannot_be_mistaken_for_the_application(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            (root / "buildSrc").mkdir()
            (root / "buildSrc/build.gradle").write_text("""
// Original empty helper build: no application, dependency or compiled fixture.
file('../buildsrc-evaluated.txt').text = 'actual helper build evaluated'
""")
            process, report = self.invoke(root)
            self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
            self.assertEqual((root / "buildsrc-evaluated.txt").read_text(), "actual helper build evaluated")
            self.assertIsNotNone(report)
            self.assertTrue(report["runtimeInputResolutionComplete"])
            self.assertTrue(report["syntheticFixture"])
            self.assertFalse(report["distributable"])

    def test_top_level_without_app_is_still_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "settings.gradle").write_text("rootProject.name = 'missing-application'\n")
            process, report = self.invoke(root)
            self.assertNotEqual(process.returncode, 0, process.stdout + process.stderr)
            self.assertIn("Actual :app project required for runtime inventory", process.stdout + process.stderr)
            self.assertIsNone(report)

    def test_unflavored_release_cannot_replace_the_actual_universal_variant(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            build = root / "app/build.gradle"
            build.write_text(build.read_text().replace("universalReleaseRuntimeClasspath", "releaseRuntimeClasspath"))
            process, report = self.invoke(root)
            self.assertNotEqual(process.returncode, 0, process.stdout + process.stderr)
            self.assertIn("universalReleaseRuntimeClasspath", process.stdout + process.stderr)
            self.assertIsNone(report)

    def test_project_artifact_producer_runs_before_its_actual_bytes_are_hashed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            payload = root / "bridge/payload"
            payload.mkdir()
            (payload / "fixture.txt").write_text("original task-produced fixture, not compiled Android code")
            (root / "bridge/build.gradle").write_text("""
configurations.create('default')
def bundle = tasks.register('fixtureJar', Zip) {
    archiveFileName = 'bridge.jar'
    destinationDirectory = layout.buildDirectory.dir('fixtures')
    from('payload')
}
artifacts { add('default', bundle) { type = 'jar' } }
""")
            output = root / "bridge/build/fixtures/bridge.jar"
            self.assertFalse(output.exists())
            process, report = self.invoke(root)
            self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
            self.assertIsNotNone(report)
            self.assertTrue(output.is_file())
            self.assertIn(":bridge:fixtureJar", process.stdout)
            artifacts = [item for item in report["artifacts"] if item["component"] == "project :bridge"]
            self.assertEqual(len(artifacts), 1)
            self.assertEqual(artifacts[0]["sha256"], hashlib.sha256(output.read_bytes()).hexdigest())
            self.assertTrue(report["runtimeInputResolutionComplete"])
            self.assertFalse(report["apkPayloadVerified"])

    def test_typed_view_selects_runtime_bytes_and_producer_among_project_metadata_variants(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            payload = root / "bridge/payload"
            payload.mkdir()
            (payload / "fixture.txt").write_text("actual selected runtime fixture, not Android bytecode")
            (root / "bridge/metadata.txt").write_text("metadata must not replace the runtime artifact")
            (root / "bridge/build.gradle").write_text("""
import org.gradle.api.artifacts.type.ArtifactTypeDefinition
configurations.create('default')
def bundle = tasks.register('fixtureJar', Zip) {
    archiveFileName = 'bridge.jar'
    destinationDirectory = layout.buildDirectory.dir('fixtures')
    from('payload')
}
configurations.default.outgoing.variants {
    create('runtimeJar') {
        attributes.attribute(ArtifactTypeDefinition.ARTIFACT_TYPE_ATTRIBUTE, 'jar')
        artifact(bundle)
    }
    create('aarMetadata') {
        attributes.attribute(ArtifactTypeDefinition.ARTIFACT_TYPE_ATTRIBUTE, 'android-aar-metadata')
        artifact(file('metadata.txt'))
    }
}
""")
            output = root / "bridge/build/fixtures/bridge.jar"
            self.assertFalse(output.exists())
            process, report = self.invoke(root)
            self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
            self.assertIsNotNone(report)
            self.assertTrue(report["runtimeInputResolutionComplete"])
            self.assertEqual(report["artifactSelection"], "jar")
            self.assertIn(":bridge:fixtureJar", process.stdout)
            artifacts = [item for item in report["artifacts"] if item["component"] == "project :bridge"]
            self.assertEqual(len(artifacts), 1)
            self.assertEqual(artifacts[0]["name"], "bridge.jar")
            self.assertEqual(artifacts[0]["sha256"], hashlib.sha256(output.read_bytes()).hexdigest())
            self.assertFalse(report["distributable"])

    def test_project_without_matching_runtime_archive_cannot_claim_resolution_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            # A neutral filename must not mask an incompatible published type.
            (root / "bridge/build.gradle").write_text("""
configurations.create('default')
artifacts { add('default', file('bridge.jar')) { type = 'zip' } }
""")
            process, report = self.invoke(root)
            self.assertNotEqual(process.returncode, 0, process.stdout + process.stderr)
            self.assertIsNotNone(report)
            self.assertFalse(report["runtimeInputResolutionComplete"])
            self.assertIn("project :bridge: selected runtime artifact absent", report["findings"])
            self.assertFalse(report["distributable"])

    def test_inventory_refuses_to_schedule_application_build_tasks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            build = root / "app/build.gradle"
            build.write_text(build.read_text() + """
tasks.register('forbiddenAppBuild') {
    doLast { file('forbidden-app-task.txt').text = 'this task must not run' }
}
""")
            process, report = self.invoke(root, extra_tasks=(":app:forbiddenAppBuild",))
            self.assertNotEqual(process.returncode, 0, process.stdout + process.stderr)
            self.assertIn("Runtime input inventory must not schedule application build tasks", process.stdout + process.stderr)
            self.assertFalse((root / "app/forbidden-app-task.txt").exists())
            self.assertIsNone(report)

    def test_missing_real_runtime_artifact_cannot_claim_resolution_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            process, report = self.invoke(self.fixture(directory, missing=True))
            self.assertNotEqual(process.returncode, 0, process.stdout + process.stderr)
            self.assertIsNotNone(report, process.stdout + process.stderr)
            self.assertFalse(report["runtimeInputResolutionComplete"])
            self.assertGreater(report["resolutionFailureCount"], 0)

    def test_synthetic_graph_cannot_pass_actual_android_application_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            process, report = self.invoke(self.fixture(directory), mode="android")
            self.assertNotEqual(process.returncode, 0, process.stdout + process.stderr)
            self.assertIsNotNone(report, process.stdout + process.stderr)
            self.assertFalse(report["runtimeInputResolutionComplete"])
            self.assertIn("Actual Android appcompat runtime dependency absent", report["findings"])


if __name__ == "__main__":
    unittest.main()
