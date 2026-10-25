//! JNI ownership boundary before AndroidUsb becomes the transport owner.
//! No USB protocol, permissions, CAT/PTT or transmit policy lives here.
use super::jni;
use jni::objects::{GlobalRef, JObject};
use std::io;

pub(super) fn checked<T>(result: jni::errors::Result<T>) -> io::Result<T> {
    result.map_err(|error| io::Error::other(error.to_string()))
}

pub(super) fn local_call<T>(
    env: &mut jni::JNIEnv<'_>,
    action: impl FnOnce(&mut jni::JNIEnv<'_>) -> io::Result<T>,
) -> io::Result<T> {
    // Release every temporary on successful AND early-return paths, even if the
    // existing worker thread was already attached before this operation.
    let framed: jni::errors::Result<io::Result<T>> =
        env.with_local_frame(32, |env| Ok(action(env)));
    let result = checked(framed).and_then(|result| result);
    if env.exception_check().unwrap_or(true) {
        let _ = env.exception_clear();
        return Err(io::Error::other(format!(
            "Android FT4222 permission/USB operation failed: {}",
            result.err().map(|error| error.to_string()).unwrap_or_default()
        )));
    }
    result
}

pub(super) fn finish_open(
    env: &mut jni::JNIEnv<'_>,
    session: &JObject<'_>,
) -> io::Result<(GlobalRef, usize)> {
    finish_open_with(env, session, |env, session| checked(env.new_global_ref(session)))
}

pub(super) fn finish_open_with(
    env: &mut jni::JNIEnv<'_>,
    session: &JObject<'_>,
    promote: impl FnOnce(&mut jni::JNIEnv<'_>, &JObject<'_>) -> io::Result<GlobalRef>,
) -> io::Result<(GlobalRef, usize)> {
    if session.is_null() {
        return Err(io::Error::other("Android FT4222 returned a null session"));
    }
    let result = (|| {
        let packet = checked(env.call_method(session, "packetBytes", "()I", &[]))?;
        let packet = checked(packet.i())?;
        Ok((promote(env, session)?, packet as usize))
    })();
    if result.is_err() {
        // An exception must be cleared BEFORE invoking Java close. We still
        // have the local session even when promotion to a global ref failed.
        if env.exception_check().unwrap_or(true) {
            let _ = env.exception_clear();
        }
        if env.call_method(session, "close", "()V", &[]).is_err() {
            eprintln!("Android FT4222 partial-open cleanup failed");
        }
        // Cleanup failure must not poison the reused worker or replace the
        // original opening error. The normal owner is never created on failure.
        if env.exception_check().unwrap_or(true) {
            let _ = env.exception_clear();
        }
    }
    result
}
