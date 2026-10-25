//! Genuine direct-USB waterfall source. OS transport is supplied by the Android
//! shell; this module has no Tauri, JNI, proprietary FFI or device permissions.
//! Uses the same measured frame delimiter and bounded accumulator as desktop.
use super::usb_protocol::{ControlOut, ReadPackets, FT710_SETUP};
use super::{frame_end, WaterfallSource, FRAME_BYTES};
use std::io;

pub trait UsbTransport: Send {
    fn packet_bytes(&self) -> usize;
    fn control_out(&mut self, request: ControlOut) -> io::Result<()>;
    /// Separate actual-length USB transfers; status bytes have NOT been stripped.
    fn read_raw(&mut self) -> io::Result<Vec<Vec<u8>>>;
    fn close(&mut self);
}

pub struct UsbWaterfall<T: UsbTransport> {
    transport: T,
    acc: Vec<u8>,
}

impl<T: UsbTransport> UsbWaterfall<T> {
    pub fn open(transport: T) -> io::Result<Self> {
        let mut source = Self {
            transport,
            acc: Vec::with_capacity(2 * FRAME_BYTES),
        };
        // Construct the owner first: every partial configuration failure closes it.
        ReadPackets::new(source.transport.packet_bytes())?;
        for request in FT710_SETUP {
            source.transport.control_out(request)?;
        }
        Ok(source)
    }
}

impl<T: UsbTransport> WaterfallSource for UsbWaterfall<T> {
    fn read_frame(&mut self) -> io::Result<Vec<u8>> {
        let mut read = ReadPackets::new(self.transport.packet_bytes())?;
        for transfer in self.transport.read_raw()? {
            read.push(&transfer)?;
        }
        self.acc.extend_from_slice(&read.finish()?);
        let cap = 3 * FRAME_BYTES;
        if self.acc.len() > cap {
            let drop_to = self.acc.len() - cap;
            self.acc.drain(..drop_to);
        }
        match frame_end(&self.acc) {
            Some(end) => {
                let frame = self.acc[end - FRAME_BYTES..end].to_vec();
                self.acc.drain(..end);
                Ok(frame)
            }
            None => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "FT4222 stream has no complete frame trailer",
            )),
        }
    }
}

impl<T: UsbTransport> Drop for UsbWaterfall<T> {
    fn drop(&mut self) {
        self.transport.close();
    }
}

#[cfg(all(target_os = "android", feature = "yaesu-wf"))]
mod android_factory {
    use super::*;
    type Factory = Box<dyn Fn() -> io::Result<Box<dyn WaterfallSource + Send>> + Send + Sync>;
    static FACTORY: std::sync::OnceLock<Factory> = std::sync::OnceLock::new();

    pub fn register(factory: Factory) -> io::Result<()> {
        FACTORY.set(factory).map_err(|_| {
            io::Error::new(
                io::ErrorKind::AlreadyExists,
                "USB factory already registered",
            )
        })
    }

    pub fn open() -> io::Result<Box<dyn WaterfallSource + Send>> {
        FACTORY.get().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotConnected, "Android USB host not ready")
        })?()
    }
}

#[cfg(all(target_os = "android", feature = "yaesu-wf"))]
pub use android_factory::{open as open_android, register as register_android};

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct Record {
        setup: Vec<ControlOut>,
        closed: usize,
    }
    struct Wire {
        record: Arc<Mutex<Record>>,
        data: Vec<u8>,
        fail_at: Option<usize>,
    }
    impl UsbTransport for Wire {
        fn packet_bytes(&self) -> usize {
            512
        }
        fn control_out(&mut self, request: ControlOut) -> io::Result<()> {
            let mut record = self.record.lock().unwrap();
            if self.fail_at == Some(record.setup.len()) {
                return Err(io::Error::other("modeled USB control failure"));
            }
            record.setup.push(request);
            Ok(())
        }
        fn read_raw(&mut self) -> io::Result<Vec<Vec<u8>>> {
            Ok(self
                .data
                .chunks(510)
                .map(|p| [2, 0].into_iter().chain(p.iter().copied()).collect())
                .collect())
        }
        fn close(&mut self) {
            self.record.lock().unwrap().closed += 1;
        }
    }

    #[test]
    fn actual_usb_source_configures_then_returns_latest_realigned_frame() {
        let record = Arc::new(Mutex::new(Record::default()));
        let mut data = vec![7; FRAME_BYTES];
        data[FRAME_BYTES - 16..].copy_from_slice(&super::super::FRAME_TRAILER);
        let mut last = vec![9; FRAME_BYTES];
        last[FRAME_BYTES - 16..].copy_from_slice(&super::super::FRAME_TRAILER);
        data.extend_from_slice(&last);
        data.rotate_left(137);
        let mut source = UsbWaterfall::open(Wire {
            record: record.clone(),
            data,
            fail_at: None,
        })
        .unwrap();
        assert_eq!(record.lock().unwrap().setup, FT710_SETUP);
        assert_eq!(source.read_frame().unwrap(), last);
        assert_eq!(source.acc.len(), 137);
        drop(source);
        assert_eq!(record.lock().unwrap().closed, 1);
    }

    #[test]
    fn every_partial_setup_failure_closes_without_continuing() {
        for fail_at in 0..FT710_SETUP.len() {
            let record = Arc::new(Mutex::new(Record::default()));
            assert!(UsbWaterfall::open(Wire {
                record: record.clone(),
                data: Vec::new(),
                fail_at: Some(fail_at),
            })
            .is_err());
            let record = record.lock().unwrap();
            assert_eq!(record.closed, 1);
            assert_eq!(record.setup.len(), fail_at);
        }
    }

    #[test]
    fn incomplete_transaction_never_reaches_the_frame_accumulator() {
        let mut source = UsbWaterfall::open(Wire {
            record: Arc::new(Mutex::new(Record::default())),
            data: vec![0; FRAME_BYTES],
            fail_at: None,
        })
        .unwrap();
        assert_eq!(
            source.read_frame().unwrap_err().kind(),
            io::ErrorKind::UnexpectedEof
        );
        assert!(source.acc.is_empty());
    }
    #[test]
    fn absent_trailers_never_invent_frames_or_grow_the_accumulator() {
        let mut source = UsbWaterfall::open(Wire {
            record: Arc::new(Mutex::new(Record::default())),
            data: vec![0; 8192],
            fail_at: None,
        })
        .unwrap();
        for _ in 0..10 {
            assert!(source.read_frame().is_err());
            assert!(source.acc.len() <= 3 * FRAME_BYTES);
        }
    }
}
