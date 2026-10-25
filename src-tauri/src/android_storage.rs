//! Android storage roots, established BEFORE diagnostic/settings/logbook startup.
//!
//! Android's Activity.getFilesDir() supplies the app-private filesystem root; HOME,
//! XDG, external storage and SAF content URIs are not substitutes for that root.
//! No environment variables, credentials, data pointers or existing logs are changed.
//! This does not implement document import/export, backups or Android lifecycle.
//!
//! The JNI bridge is isolated here because early startup has no AppHandle yet.
//! It uses the same Android context and JNI version re-exported by locked Tauri/Tao,
//! rather than creating a second VM, hardcoding an application ID or adding a library.
//! A missing context or unwritable root stops startup BEFORE any station data opens.

use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug)]
struct StorageRoots {
    config: PathBuf,
    data: PathBuf,
}

impl StorageRoots {
    fn open(files_dir: &Path) -> io::Result<Self> {
        if !files_dir.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Android private files directory must be absolute",
            ));
        }
        let files_dir = files_dir.canonicalize()?;
        if !files_dir.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "Android private files root is not a directory",
            ));
        }
        let config = private_child(&files_dir, "config")?;
        let data = private_child(&files_dir, "data")?.join("Nexus");
        std::fs::create_dir_all(&data)?;
        let data = data.canonicalize()?;
        if !data.starts_with(&files_dir) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Android local data escaped private storage",
            ));
        }
        Ok(Self { config, data })
    }
}

fn private_child(root: &Path, name: &str) -> io::Result<PathBuf> {
    let child = root.join(name);
    std::fs::create_dir_all(&child)?;
    let child = child.canonicalize()?;
    if !child.starts_with(root) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Android storage child escaped private storage",
        ));
    }
    Ok(child)
}

#[cfg(target_os = "android")]
static ROOTS: std::sync::OnceLock<Result<StorageRoots, String>> = std::sync::OnceLock::new();

#[cfg(target_os = "android")]
pub(crate) fn initialize() -> Result<(), String> {
    ROOTS
        .get_or_init(|| {
            let files_dir = android_files_dir().map_err(|e| e.to_string())?;
            StorageRoots::open(&files_dir).map_err(|e| e.to_string())
        })
        .as_ref()
        .map(|_| ())
        .map_err(Clone::clone)
}

#[cfg(target_os = "android")]
fn roots() -> &'static StorageRoots {
    ROOTS
        .get()
        .expect("Android storage must be initialized before station startup")
        .as_ref()
        .expect("Android storage initialization failed; startup must not continue")
}

#[cfg(target_os = "android")]
pub(crate) fn config_base() -> PathBuf {
    roots().config.clone()
}

#[cfg(target_os = "android")]
pub(crate) fn local_data_dir() -> PathBuf {
    roots().data.clone()
}

#[cfg(target_os = "android")]
fn android_files_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    use tauri::tao::platform::android::prelude::{jni, main_android_context, JObject, JString};

    let context = main_android_context().ok_or("Android Activity context is unavailable")?;
    // SAFETY: Tao owns this VM and Activity global reference and publishes them before
    // the mobile entry point. Attach our startup thread, then take a local reference.
    // We neither destroy the VM nor delete/retain Tao's global reference.
    let vm = unsafe { jni::JavaVM::from_raw(context.java_vm.cast()) }?;
    let mut env = vm.attach_current_thread()?;
    let result = (|| {
        let activity = unsafe { JObject::from_raw(context.context_jobject.cast()) };
        let activity = env.new_local_ref(activity)?;
        let files = env
            .call_method(&activity, "getFilesDir", "()Ljava/io/File;", &[])?
            .l()?;
        let path = env
            .call_method(&files, "getAbsolutePath", "()Ljava/lang/String;", &[])?
            .l()?;
        let path = JString::from(path);
        let path: String = env.get_string(&path)?.into();
        Ok(PathBuf::from(path))
    })();
    // Do not return to the Android event machinery with a pending Java exception.
    if result.is_err() && env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Sandbox(PathBuf);

    impl Sandbox {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "nexus-private-storage-{}-{stamp}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path.canonicalize().unwrap())
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let temp = std::env::temp_dir().canonicalize().unwrap();
            assert!(self.0.starts_with(temp));
            let name = self.0.file_name().unwrap().to_string_lossy();
            assert!(name.starts_with("nexus-private-storage-"));
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn real_private_directories_are_writable_and_survive_reopening() {
        let sandbox = Sandbox::new();
        let first = StorageRoots::open(&sandbox.0).unwrap();
        assert_eq!(first.config, sandbox.0.join("config"));
        assert_eq!(first.data, sandbox.0.join("data/Nexus"));
        let settings = first.config.join("tempo");
        std::fs::create_dir(&settings).unwrap();
        std::fs::write(settings.join("settings.json"), b"{\"preserve\":true}").unwrap();
        std::fs::write(first.data.join("ALL.TXT"), b"existing decode log\n").unwrap();
        let reopened = StorageRoots::open(&sandbox.0).unwrap();
        assert_eq!(reopened.config, first.config);
        assert_eq!(reopened.data, first.data);
        assert_eq!(
            std::fs::read(settings.join("settings.json")).unwrap(),
            b"{\"preserve\":true}"
        );
        assert_eq!(
            std::fs::read(reopened.data.join("ALL.TXT")).unwrap(),
            b"existing decode log\n"
        );
    }

    #[test]
    fn relative_and_content_uri_roots_are_refused_not_treated_as_filesystem_paths() {
        for path in [".", "relative", "content://provider/tree/documents"] {
            let error = StorageRoots::open(Path::new(path)).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        }
    }

    #[test]
    fn missing_root_and_file_instead_of_directory_fail_closed() {
        let sandbox = Sandbox::new();
        assert!(StorageRoots::open(&sandbox.0.join("absent")).is_err());
        std::fs::write(sandbox.0.join("file"), b"keep").unwrap();
        assert!(StorageRoots::open(&sandbox.0.join("file")).is_err());
        std::fs::write(sandbox.0.join("config"), b"keep too").unwrap();
        assert!(StorageRoots::open(&sandbox.0).is_err());
        assert_eq!(
            std::fs::read(sandbox.0.join("config")).unwrap(),
            b"keep too"
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_cannot_redirect_configuration_outside_the_private_root() {
        let inside = Sandbox::new();
        let outside = Sandbox::new();
        std::os::unix::fs::symlink(&outside.0, inside.0.join("config")).unwrap();
        let error = StorageRoots::open(&inside.0).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(std::fs::read_dir(&outside.0).unwrap().count(), 0);
    }
}
