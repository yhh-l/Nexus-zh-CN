//! Cloud-only real JVM execution of the SAME ownership module used by Android.
//! The Java object is an original controlled fixture, not Android USB hardware.
pub use jni;

#[path = "../../../src-tauri/src/android_ft4222/ownership.rs"]
mod ownership;

#[cfg(test)]
mod tests {
    use super::*;
    use jni::objects::{GlobalRef, JObject, JValue};
    use jni::{InitArgsBuilder, JNIVersion, JavaVM};
    use std::io;
    use std::sync::OnceLock;

    fn vm() -> &'static JavaVM {
        static VM: OnceLock<JavaVM> = OnceLock::new();
        VM.get_or_init(|| {
            let classes =
                std::env::var("NEXUS_JNI_FIXTURE_CLASSES").expect("Cloud Java fixture required");
            let classpath = format!("-Djava.class.path={classes}");
            let args = InitArgsBuilder::new()
                .version(JNIVersion::V8)
                .option(&classpath)
                .option("-Xcheck:jni")
                .build()
                .unwrap();
            JavaVM::new(args).unwrap()
        })
    }

    fn fixture(env: &mut jni::JNIEnv<'_>, packet_failure: bool, close_failure: bool) -> GlobalRef {
        let object = env
            .new_object(
                "nexus/fixture/FixtureUsb",
                "(ZZ)V",
                &[
                    JValue::Bool(u8::from(packet_failure)),
                    JValue::Bool(u8::from(close_failure)),
                ],
            )
            .unwrap();
        env.new_global_ref(object).unwrap()
    }

    fn closes(env: &mut jni::JNIEnv<'_>, object: &GlobalRef) -> i32 {
        env.get_field(object.as_obj(), "closeCount", "I")
            .unwrap()
            .i()
            .unwrap()
    }

    #[test]
    fn successful_handoff_survives_local_frame_and_is_not_prematurely_closed() {
        let mut env = vm().attach_current_thread().unwrap();
        let observer = fixture(&mut env, false, false);
        let (session, packet) = ownership::local_call(&mut env, |env| {
            ownership::finish_open(env, observer.as_obj())
        })
        .unwrap();
        assert_eq!(packet, 512);
        assert_eq!(closes(&mut env, &observer), 0);
        env.call_method(session.as_obj(), "close", "()V", &[])
            .unwrap();
        assert_eq!(closes(&mut env, &observer), 1);
        assert!(!env.exception_check().unwrap());
    }

    #[test]
    fn packet_getter_exception_closes_partial_session_and_clears_worker_exception() {
        let mut env = vm().attach_current_thread().unwrap();
        let observer = fixture(&mut env, true, false);
        let result = ownership::local_call(&mut env, |env| {
            ownership::finish_open(env, observer.as_obj())
        });
        assert!(result.is_err());
        assert_eq!(closes(&mut env, &observer), 1);
        assert!(!env.exception_check().unwrap());
    }

    #[test]
    fn promotion_failure_with_pending_java_exception_still_closes_exactly_once() {
        let mut env = vm().attach_current_thread().unwrap();
        let observer = fixture(&mut env, false, false);
        let error = ownership::local_call(&mut env, |env| {
            ownership::finish_open_with(env, observer.as_obj(), |env, _| {
                ownership::checked(
                    env.throw_new("java/lang/OutOfMemoryError", "controlled promotion failure"),
                )?;
                Err(io::Error::other("controlled global-ref promotion failure"))
            })
        })
        .err()
        .expect("opening must fail");
        assert_eq!(error.to_string(), "controlled global-ref promotion failure");
        assert_eq!(closes(&mut env, &observer), 1);
        assert!(!env.exception_check().unwrap());
    }

    #[test]
    fn cleanup_exception_preserves_open_error_and_does_not_poison_next_call() {
        let mut env = vm().attach_current_thread().unwrap();
        let observer = fixture(&mut env, false, true);
        let error = ownership::local_call(&mut env, |env| {
            ownership::finish_open_with(env, observer.as_obj(), |_, _| {
                Err(io::Error::other("primary opening failure"))
            })
        })
        .err()
        .expect("opening must fail");
        assert_eq!(error.to_string(), "primary opening failure");
        assert_eq!(closes(&mut env, &observer), 1);
        assert!(!env.exception_check().unwrap());
        assert_eq!(ownership::local_call(&mut env, |_| Ok(42)).unwrap(), 42);
    }

    #[test]
    fn null_open_result_and_unowned_java_exception_fail_without_pending_exception() {
        let mut env = vm().attach_current_thread().unwrap();
        assert!(
            ownership::local_call(&mut env, |env| ownership::finish_open(
                env,
                &JObject::null()
            ))
            .is_err()
        );
        let error = ownership::local_call::<()>(&mut env, |env| {
            ownership::checked(
                env.throw_new("java/lang/IllegalStateException", "controlled open failure"),
            )?;
            Err(io::Error::other("opening returned no owned session"))
        })
        .err()
        .expect("opening must fail");
        assert!(error
            .to_string()
            .contains("opening returned no owned session"));
        assert!(!env.exception_check().unwrap());
    }
}
