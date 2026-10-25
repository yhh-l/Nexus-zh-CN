"""Graph admission controls only; real package texts are generated separately in Actions."""
import copy
import importlib.util
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


if __name__ == "__main__":
    unittest.main()
