//! Validate a native directory result without creating, moving or opening station data.
//! SAF content URIs and paths escaping the OS-provided app roots are not SQLite paths.

use std::path::{Path, PathBuf};

pub(crate) fn selected(roots: &[PathBuf], path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || path.to_string_lossy().contains("://") {
        return Err("The data folder must be a local Android filesystem directory".into());
    }
    let selected = path.canonicalize().map_err(|e| format!("Cannot resolve data folder: {e}"))?;
    if !selected.is_dir() {
        return Err("The selected data folder is not a directory".into());
    }
    if !roots.iter().any(|root| selected.starts_with(root)) {
        return Err("The selected directory escaped Android app storage".into());
    }
    Ok(selected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let dir = std::env::temp_dir().join(format!("nexus-folder-policy-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            std::fs::create_dir(&dir).unwrap();
            Self(dir.canonicalize().unwrap())
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            assert!(self.0.starts_with(std::env::temp_dir().canonicalize().unwrap()));
            assert!(self.0.file_name().unwrap().to_string_lossy().starts_with("nexus-folder-policy-"));
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn actual_selection_is_canonical_and_does_not_change_the_log() {
        let root = Sandbox::new();
        let data = root.0.join("data");
        std::fs::create_dir(&data).unwrap();
        std::fs::write(data.join("log.adi"), b"existing contacts").unwrap();
        assert_eq!(selected(&[root.0.clone()], &data.join(".")).unwrap(), data);
        assert_eq!(std::fs::read(data.join("log.adi")).unwrap(), b"existing contacts");
    }

    #[test]
    fn document_uris_and_relative_paths_are_not_filesystem_folders() {
        let root = Sandbox::new();
        for bad in ["content://documents/tree/primary%3ANexus", "data/Nexus", "file://storage/data"] {
            assert!(selected(&[root.0.clone()], Path::new(bad)).is_err());
        }
    }

    #[test]
    fn sibling_prefix_and_traversal_do_not_escape_the_root() {
        let base = Sandbox::new();
        let root = base.0.join("app");
        let sibling = base.0.join("app-other");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&sibling).unwrap();
        assert!(selected(&[root.clone()], &sibling).is_err());
        assert!(selected(&[root.clone()], &root.join("../app-other")).is_err());
        assert!(selected(&[root.clone()], &root).is_ok());
    }

    #[test]
    fn missing_folders_and_regular_files_are_not_created_or_selected() {
        let root = Sandbox::new();
        let missing = root.0.join("missing");
        assert!(selected(&[root.0.clone()], &missing).is_err());
        assert!(!missing.exists());
        let file = root.0.join("log.adi");
        std::fs::write(&file, b"keep").unwrap();
        assert!(selected(&[root.0.clone()], &file).is_err());
        assert_eq!(std::fs::read(file).unwrap(), b"keep");
        assert!(selected(&[], &root.0).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_to_another_apps_directory_is_refused() {
        let root = Sandbox::new();
        let outside = Sandbox::new();
        let escape = root.0.join("escape");
        std::os::unix::fs::symlink(&outside.0, &escape).unwrap();
        assert!(selected(&[root.0.clone()], &escape).is_err());
    }
}
