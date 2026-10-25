//! Original Nexus FT4222 USB wire primitives, independent of an OS or FTDI library.
//!
//! Protocol facts were checked against SourceArcade/flashprog `ft4222_spi.c` at
//! 610c1aad71bfa118c4f49ac01761f586b8dede69 (Nico Huber, GPL-2.0-or-later).
//! No upstream implementation is copied. See NOTICE for the reference and review.
//! The FT-710 settings come from this parent's measured, existing working driver,
//! NOT flash-programmer defaults: idle HIGH, trailing edge, 48 MHz / 16, SS0.
//!
//! This is NOT an Android USB Host connection or a replacement WaterfallSource yet.
//! That bridge must own a user-granted interface A, validate its bulk endpoints,
//! submit bounded full-duplex I/O (8192 dummy bytes and a zero-length OUT to end CS),
//! and feed each completed IN transfer's ACTUAL bytes here. Never join USB transfers
//! before decoding: every packet has two status bytes, including a short packet.

use std::io;

pub const VENDOR_ID: u16 = 0x0403;
pub const PRODUCT_ID: u16 = 0x601c;
pub const READ_BYTES: usize = 8192;

/// A vendor, device-recipient OUT setup packet with no data stage. The host must
/// require a zero-length success; a negative/short/failed request is not success.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ControlOut {
    pub request_type: u8,
    pub request: u8,
    pub value: u16,
    pub index: u16,
}

const fn reset(value: u16, index: u16) -> ControlOut {
    ControlOut {
        request_type: 0x40,
        request: 0x00,
        value,
        index,
    }
}

const fn config(command: u8, value: u8) -> ControlOut {
    ControlOut {
        request_type: 0x40,
        request: 0x21,
        value: ((value as u16) << 8) | command as u16,
        index: 1, // USB interface A: zero-based interface + 1 for vendor requests.
    }
}

/// Ordered interface-A setup. Fail closed on the first failed control request;
/// don't continue with plausible-looking bins from a partially configured bridge.
/// Six output flushes precede the input flush, as in the direct-USB reference.
pub const FT710_SETUP: [ControlOut; 18] = [
    reset(0, 0),
    reset(1, 1),
    reset(1, 1),
    reset(1, 1),
    reset(1, 1),
    reset(1, 1),
    reset(1, 1),
    reset(2, 1),
    config(0x04, 2), // System clock 48 MHz.
    config(0x49, 0), // Reset transaction on channel/CS0.
    config(0x42, 1), // Single SPI I/O.
    config(0x4a, 1), // Apply/reset line-count setting.
    config(0x44, 4), // Divide clock by 16.
    config(0x45, 1), // Clock idles HIGH (not the flash-programmer default).
    config(0x46, 1), // Capture on trailing edge.
    config(0x43, 0), // Chip select active low.
    config(0x48, 1), // Only SS0 enabled.
    config(0x05, 3), // Enter SPI master after configuring it.
];

/// Exactly one 8192-byte SPI read, NOT a frame parser. The existing trailer
/// realignment/three-frame accumulator must still consume the decoded byte pipe.
/// The bound prevents device data from growing an unbounded allocation.
pub struct ReadPackets {
    packet_bytes: usize,
    bytes: Vec<u8>,
    invalid: bool,
}

impl ReadPackets {
    /// Use the claimed IN endpoint's actual maxPacketSize, never a buffer size.
    /// FT4222 bulk is 512 bytes at high speed, 64 bytes at full speed.
    pub fn new(packet_bytes: usize) -> io::Result<Self> {
        if !matches!(packet_bytes, 64 | 512) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Unsupported FT4222 bulk packet size",
            ));
        }
        Ok(Self {
            packet_bytes,
            bytes: Vec::with_capacity(READ_BYTES),
            invalid: false,
        })
    }

    /// Feed ONE completed bulk transfer, sliced to its actual returned length.
    /// Validate the WHOLE transfer before appending any bytes, so a malformed last
    /// packet or unexpected extra payload cannot expose partially accepted data.
    /// Status bytes are not spectrum data, even when they differ from 02 00.
    pub fn push(&mut self, transfer: &[u8]) -> io::Result<()> {
        if self.invalid {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "FT4222 transaction already failed",
            ));
        }
        let result = self.push_checked(transfer);
        self.invalid = result.is_err();
        result
    }

    fn push_checked(&mut self, transfer: &[u8]) -> io::Result<()> {
        // Bound work even if a broken adapter supplies a bogus oversized buffer.
        let packets = READ_BYTES.div_ceil(self.packet_bytes - 2);
        if transfer.len() > packets * self.packet_bytes {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Oversized FT4222 USB transfer",
            ));
        }
        let mut payload = 0;
        for packet in transfer.chunks(self.packet_bytes) {
            if packet.len() < 2 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "FT4222 packet lacks its two status bytes",
                ));
            }
            payload += packet.len() - 2;
        }
        if payload > READ_BYTES - self.bytes.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "FT4222 returned more SPI bytes than requested",
            ));
        }
        for packet in transfer.chunks(self.packet_bytes) {
            self.bytes.extend_from_slice(&packet[2..]);
        }
        Ok(())
    }

    pub fn remaining(&self) -> usize {
        READ_BYTES - self.bytes.len()
    }

    /// Never zero-fill, silently truncate, or hand an incomplete read to the
    /// existing frame accumulator as a successful transaction.
    pub fn finish(self) -> io::Result<Vec<u8>> {
        if self.invalid {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Cannot accept a failed FT4222 transaction",
            ));
        }
        if self.remaining() != 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Incomplete FT4222 SPI transaction",
            ));
        }
        Ok(self.bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(data: &[u8], packet_bytes: usize) -> Vec<u8> {
        data.chunks(packet_bytes - 2)
            .flat_map(|payload| [0x02, 0x00].into_iter().chain(payload.iter().copied()))
            .collect()
    }

    #[test]
    fn measured_ft710_settings_not_flash_defaults() {
        let values: Vec<_> = FT710_SETUP[8..].iter().map(|r| r.value).collect();
        assert_eq!(
            values,
            [0x0204, 0x0049, 0x0142, 0x014a, 0x0444, 0x0145, 0x0146, 0x0043, 0x0148, 0x0305]
        );
        for request in &FT710_SETUP {
            assert_eq!(request.request_type, 0x40);
        }
        assert_eq!(FT710_SETUP[0], reset(0, 0));
        assert_eq!(&FT710_SETUP[1..7], &[reset(1, 1); 6]);
        assert_eq!(FT710_SETUP[7], reset(2, 1));
        assert!(FT710_SETUP[1..].iter().all(|r| r.index == 1));
    }

    #[test]
    fn every_packet_status_is_removed_without_touching_payload() {
        for packet_bytes in [64, 512] {
            let original: Vec<_> = (0..READ_BYTES).map(|i| (i % 251) as u8).collect();
            let wire = encode(&original, packet_bytes);
            let mut read = ReadPackets::new(packet_bytes).unwrap();
            // Each transfer ends on a packet boundary; the final one may be short.
            for transfer in wire.chunks(4 * packet_bytes) {
                read.push(transfer).unwrap();
            }
            assert_eq!(read.remaining(), 0);
            assert_eq!(read.finish().unwrap(), original);
        }
    }

    #[test]
    fn short_transfers_keep_their_own_status_boundaries() {
        let mut read = ReadPackets::new(512).unwrap();
        // Separate short transfers must not be concatenated before stripping headers.
        for _ in 0..READ_BYTES {
            read.push(&[0x02, 0x00, 0x7b]).unwrap();
        }
        assert_eq!(read.finish().unwrap(), vec![0x7b; READ_BYTES]);
    }

    #[test]
    fn zero_and_status_only_transfers_do_not_fabricate_progress() {
        let mut read = ReadPackets::new(512).unwrap();
        read.push(&[]).unwrap();
        read.push(&[0x02, 0x00]).unwrap();
        assert_eq!(read.remaining(), READ_BYTES);
        assert_eq!(
            read.finish().unwrap_err().kind(),
            io::ErrorKind::UnexpectedEof
        );
    }

    #[test]
    fn unknown_status_is_not_injected_into_bins() {
        let mut read = ReadPackets::new(512).unwrap();
        read.push(&[0xff, 0xaa, 0x17]).unwrap();
        assert_eq!(read.bytes, [0x17]);
    }

    #[test]
    fn malformed_tail_rejects_entire_transfer_without_partial_append() {
        let mut read = ReadPackets::new(512).unwrap();
        let mut transfer = encode(&[0x7b; 510], 512);
        transfer.push(0x02);
        assert_eq!(
            read.push(&transfer).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        assert_eq!(read.remaining(), READ_BYTES);
        assert!(read.push(&[0x02]).is_err());
        assert!(read.push(&[0x02, 0x00, 0x7b]).is_err());
        assert_eq!(
            read.finish().unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn overflow_is_refused_not_truncated_or_retained_for_next_read() {
        let mut read = ReadPackets::new(512).unwrap();
        read.push(&encode(&[0x7b; READ_BYTES], 512)).unwrap();
        assert!(read.push(&[0x02, 0x00, 0x17]).is_err());
        assert_eq!(
            read.finish().unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn endpoint_size_and_unbounded_buffers_are_rejected() {
        for size in [0, 1, 2, 63, 65, 511, 513, usize::MAX] {
            assert!(ReadPackets::new(size).is_err());
        }
        let mut read = ReadPackets::new(512).unwrap();
        assert!(read.push(&[0; 16_384]).is_err());
        assert_eq!(read.remaining(), READ_BYTES);
    }
}
