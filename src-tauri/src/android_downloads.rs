//! Public Downloads export, invoked only by the existing explicit save commands.
//! Android MediaStore is not a filesystem path or a replacement private data root.
//! The real Java transport writes a new pending document and verifies before publish.
//! No Activity UI/permission request, station lock, credential or TX behavior changes.
use tauri::tao::platform::android::prelude::jni::objects::{JClass, JObject, JString, JValue};
use tauri::tao::platform::android::prelude::{jni, main_android_context};

pub(crate) fn save(name: &str, bytes: &[u8], mime: &str) -> Result<String, String> {
    let context = main_android_context().ok_or("Android application context is unavailable")?;
    // SAFETY: Tao owns the published VM/Activity global. Borrow it only to acquire
    // local references inside this worker's bounded JNI frame; never delete it.
    let vm = unsafe { jni::JavaVM::from_raw(context.java_vm.cast()) }
        .map_err(|error| error.to_string())?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| error.to_string())?;
    let result: jni::errors::Result<String> = env.with_local_frame(32, |env| {
        let activity = unsafe { JObject::from_raw(context.context_jobject.cast()) };
        let activity = env.new_local_ref(activity)?;
        let application = env
            .call_method(
                &activity,
                "getApplicationContext",
                "()Landroid/content/Context;",
                &[],
            )?
            .l()?;
        let loader = env
            .call_method(
                &application,
                "getClassLoader",
                "()Ljava/lang/ClassLoader;",
                &[],
            )?
            .l()?;
        let class_name = env.new_string("com.kd9taw.tempo.NexusDownloads")?;
        let class = env
            .call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(class_name.as_ref())],
            )?
            .l()?;
        let class: &JClass<'_> = (&class).into();
        let name = env.new_string(name)?;
        let mime = env.new_string(mime)?;
        let bytes = env.byte_array_from_slice(bytes)?;
        let saved = env
            .call_static_method(
                class,
                "save",
                "(Landroid/content/Context;Ljava/lang/String;[BLjava/lang/String;)Ljava/lang/String;",
                &[
                    JValue::Object(&application),
                    JValue::Object(name.as_ref()),
                    JValue::Object(bytes.as_ref()),
                    JValue::Object(mime.as_ref()),
                ],
            )?
            .l()?;
        let saved = JString::from(saved);
        let saved: String = env.get_string(&saved)?.into();
        Ok(saved)
    });
    // Reused Tauri worker threads must not retain pending Java exceptions. Do not
    // print Java payloads, exported data or provider-specific details to a log.
    if env.exception_check().unwrap_or(true) {
        let _ = env.exception_clear();
        return Err("Android could not finish and verify the Downloads export".into());
    }
    result.map_err(|error| format!("Android Downloads export failed: {error}"))
}
