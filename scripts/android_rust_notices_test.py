"""Graph admission controls only; real package texts are generated separately in Actions."""
import copy
import importlib.util
import json
import tempfile
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("android_notices", Path(__file__).with_name("android-rust-notices.py"))
notices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notices)


class GraphPolicy(unittest.TestCase):
    def fixture(self):
        packages = [{"id": name, "name": name, "version": "1.0.0",
                     "source": None if name == "tempo" else "registry+fixture"}
                    for name in ["tempo", "tauri", "jni"]]
        return {"packages": packages, "resolve": {"root": "tempo"}}, "tempo v1.0.0\ntauri v1.0.0\njni v1.0.0\n"

    def test_actual_root_required_and_android_dependencies_selected(self):
        metadata, tree = self.fixture()
        self.assertEqual([p["name"] for p in notices.selected_packages(metadata, tree)], ["jni", "tauri"])
        for changed in ["", tree.replace("tempo v1.0.0\n", ""), tree.replace("jni v1.0.0\n", ""),
                        tree + "unknown v1.0.0\n"]:
            with self.subTest(tree=changed), self.assertRaises(ValueError):
                notices.selected_packages(metadata, changed)

    def test_ambiguous_or_wrong_metadata_cannot_certify_an_android_graph(self):
        metadata, tree = self.fixture()
        duplicate = copy.deepcopy(metadata)
        duplicate["packages"].append(copy.deepcopy(duplicate["packages"][1]))
        wrong_root = copy.deepcopy(metadata)
        wrong_root["resolve"]["root"] = "jni"
        for changed in [duplicate, wrong_root]:
            with self.subTest(metadata=changed), self.assertRaises(ValueError):
                notices.selected_packages(changed, tree)


class AndroidPins(unittest.TestCase):
    def inventories(self):
        desktop = json.loads(Path(notices.policy.UPSTREAM).read_text())
        android = json.loads((notices.ROOT / "licenses/rust/android-upstream.json").read_text())
        return notices.merge_android_pins(desktop, android), android

    def test_scoped_pins_never_replace_desktop_records(self):
        upstream, android = self.inventories()
        self.assertEqual(len(android["crates"]), 9)
        self.assertIn("tao-macros 0.1.3", upstream["crates"])
        for section in ("sha256", "crates"):
            a = {"sha256": {}, "crates": {}}
            b = copy.deepcopy(a)
            a[section]["collision"] = b[section]["collision"] = "same"
            with self.subTest(section=section), self.assertRaises(ValueError):
                notices.merge_android_pins(a, b)

    def test_exact_tao_release_apache_text_is_a_real_declared_election(self):
        upstream, android = self.inventories()
        with tempfile.TemporaryDirectory() as root:
            package = {"name": "tao-macros", "version": "0.1.3",
                       "license": "MIT OR Apache-2.0", "manifest_path": str(Path(root) / "Cargo.toml"),
                       "repository": "https://github.com/tauri-apps/tao"}
            used = set()
            text = notices.package_entry(package, {"MIT", "Apache-2.0"},
                                         {"MIT": 0, "Apache-2.0": 1}, upstream, android, used)
            self.assertIn("(Apache-2.0 elected)", text)
            self.assertIn("TERMS AND CONDITIONS FOR USE", text)
            self.assertEqual(used, {"tao-macros 0.1.3"})
            with self.assertRaises(notices.policy.Stop):
                notices.package_entry({**package, "license": "MIT"}, {"MIT", "Apache-2.0"},
                                      {"MIT": 0, "Apache-2.0": 1}, upstream, android, set())

    def test_tampered_license_hash_still_refused(self):
        upstream, android = self.inventories()
        file = android["crates"]["tao-macros 0.1.3"]["texts"][0][0]
        upstream["sha256"][file] = "0" * 64
        with tempfile.TemporaryDirectory() as root, self.assertRaises(notices.policy.Stop):
            notices.policy.pinned({"license": "MIT OR Apache-2.0"}, "tao-macros 0.1.3",
                                  {"Apache-2.0"}, root, upstream, set())

    def test_published_vcs_commit_is_still_enforced(self):
        upstream, android = self.inventories()
        with tempfile.TemporaryDirectory() as root:
            Path(root, ".cargo_vcs_info.json").write_text(json.dumps({"git": {"sha1": "0" * 40}}))
            with self.assertRaises(notices.policy.Stop):
                notices.policy.pinned({"license": "MIT OR Apache-2.0",
                                       "repository": "https://github.com/jni-rs/jni-rs"},
                                      "jni 0.22.4", {"MIT"}, root, upstream, set())


if __name__ == "__main__":
    unittest.main()
