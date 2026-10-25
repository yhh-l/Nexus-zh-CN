//! Android's genuine FT4222 USB Host -> WaterfallSource adapter.
//! Acquire only class/application global references on the WebView JNI queue;
//! all open/control/bulk calls execute on the existing scope worker, never UI.
//! No permission prompt, library download, radio/CAT or transmit operation.
use std::io;
use std::sync::Arc;
use tauri::tao::platform::android::prelude::jni;
use tauri::tao::platform::android::prelude::jni::objects::{
    GlobalRef, JByteArray, JClass, JObjectArray, JValue,
};
use tauri::Manager;
use tempo_audio::yaesu_wf::usb_protocol::{ControlOut, READ_BYTES};
use tempo_audio::yaesu_wf::usb_source::{self, UsbTransport, UsbWaterfall};
use tempo_audio::yaesu_wf::WaterfallSource;

mod ownership;
use ownership::checked;

struct Bridge {
    vm: jni::JavaVM,
    class: GlobalRef,
    context: GlobalRef,
}

impl Bridge {
    fn call<T>(&self, action: impl FnOnce(&mut jni::JNIEnv<'_>) -> io::Result<T>) -> io::Result<T> {
        let mut env = checked(self.vm.attach_current_thread())?;
        ownership::local_call(&mut env, action)
    }

    fn open(self: &Arc<Self>) -> io::Result<Box<dyn WaterfallSource + Send>> {
        let (session, packet_bytes) = self.call(|env| {
            // Global Class reference fixes FindClass's native-worker classloader trap.
            let class: &JClass<'_> = self.class.as_obj().into();
            let session = checked(env.call_static_method(
                class,
                "openOnlyGranted",
                "(Landroid/content/Context;)Lcom/kd9taw/tempo/NexusFt4222Usb;",
                &[JValue::Object(self.context.as_obj())],
            ))?;
            let session = checked(session.l())?;
            ownership::finish_open(env, &session)
        })?;
        let transport = AndroidUsb {
            bridge: self.clone(),
            session,
            packet_bytes,
            closed: false,
        };
        Ok(Box::new(UsbWaterfall::open(transport)?))
    }
}

struct AndroidUsb {
    bridge: Arc<Bridge>,
    session: GlobalRef,
    packet_bytes: usize,
    closed: bool,
}

impl UsbTransport for AndroidUsb {
    fn packet_bytes(&self) -> usize {
        self.packet_bytes
    }

    fn control_out(&mut self, request: ControlOut) -> io::Result<()> {
        if request.request_type != 0x40 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Not vendor OUT",
            ));
        }
        self.bridge.call(|env| {
            checked(env.call_method(
                self.session.as_obj(),
                "controlOut",
                "(III)V",
                &[
                    JValue::Int(request.request as i32),
                    JValue::Int(request.value as i32),
                    JValue::Int(request.index as i32),
                ],
            ))?;
            Ok(())
        })
    }

    fn read_raw(&mut self) -> io::Result<Vec<Vec<u8>>> {
        self.bridge.call(|env| {
            let raw = checked(env.call_method(self.session.as_obj(), "readRaw", "()[[B", &[]))?;
            let raw = JObjectArray::from(checked(raw.l())?);
            let count = checked(env.get_array_length(&raw))?;
            if count <= 0 || count as usize > READ_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Invalid USB transfer count",
                ));
            }
            let mut transfers = Vec::with_capacity(count as usize);
            let mut total = 0;
            for index in 0..count {
                let bytes = JByteArray::from(checked(env.get_object_array_element(&raw, index))?);
                let length = checked(env.get_array_length(&bytes))?;
                if !(2..=2048).contains(&length) || total + length as usize > 3 * READ_BYTES {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "Invalid raw USB length",
                    ));
                }
                total += length as usize;
                transfers.push(checked(env.convert_byte_array(&bytes))?);
                // Short-transfer-heavy streams must not exhaust the JNI local-ref table.
                checked(env.delete_local_ref(bytes))?;
            }
            checked(env.delete_local_ref(raw))?;
            Ok(transfers)
        })
    }

    fn close(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        if let Err(error) = self.bridge.call(|env| {
            checked(env.call_method(self.session.as_obj(), "close", "()V", &[]))?;
            Ok(())
        }) {
            eprintln!("Android FT4222 close failed: {error}");
        }
    }
}

impl Drop for AndroidUsb {
    fn drop(&mut self) {
        self.close();
    }
}
pub(crate) fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Android main WebView unavailable")?;
    window
        .with_webview(|webview| {
            webview.jni_handle().exec(|env, activity, _| {
                let result = (|| -> jni::errors::Result<()> {
                    let loader = env
                        .call_method(activity, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
                        .l()?;
                    let name = env.new_string("com.kd9taw.tempo.NexusFt4222Usb")?;
                    let class = env
                        .call_method(
                            loader,
                            "loadClass",
                            "(Ljava/lang/String;)Ljava/lang/Class;",
                            &[JValue::Object(name.as_ref())],
                        )?
                        .l()?;
                    let context = env
                        .call_method(
                            activity,
                            "getApplicationContext",
                            "()Landroid/content/Context;",
                            &[],
                        )?
                        .l()?;
                    let bridge = Arc::new(Bridge {
                        vm: env.get_java_vm()?,
                        class: env.new_global_ref(class)?,
                        context: env.new_global_ref(context)?,
                    });
                    if let Err(error) =
                        usb_source::register_android(Box::new(move || bridge.open()))
                    {
                        eprintln!("Android FT4222 registration failed: {error}");
                    }
                    Ok(())
                })();
                if let Err(error) = result {
                    if env.exception_check().unwrap_or(false) {
                        let _ = env.exception_clear();
                    }
                    eprintln!("Android FT4222 JNI initialization failed: {error}");
                }
            });
        })
        .map_err(|error| error.to_string())
}
