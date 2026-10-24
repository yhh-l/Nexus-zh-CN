//! Android-only native modem build. Never let an Android Cargo target fall through to
//! the host's gfortran/pkg-config path: an ARM64 label does not make a host library Android.
//! No waveform, decoder, sequencer or transmit policy is changed here.
//!
//! Requires an NDK and an Android-built dependency prefix, not desktop runtime archives.
//! The archive guard proves architecture, not libc provenance. The dependency bootstrap
//! and final Android linkage/runtime checks must prove that separately.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const TARGET: &str = "aarch64-linux-android";
pub const API: u32 = 35;

pub fn validate_target(target: &str) -> Result<(), String> {
    if target == TARGET {
        Ok(())
    } else {
        Err(format!(
            "Nexus Android port currently targets {TARGET}, not {target}"
        ))
    }
}

/// Inspect regular GNU/BSD ar members. Reject mixed-host archives as well as empty ones.
/// An AArch64 GNU/Linux archive can pass this check: target provenance is a separate gate.
pub fn inspect_archive(bytes: &[u8]) -> Result<usize, String> {
    if bytes.get(..8) != Some(b"!<arch>\n") {
        return Err("not a regular ar archive".into());
    }
    let mut offset: usize = 8;
    let mut objects = 0;
    while offset < bytes.len() {
        let header_end = offset.checked_add(60).ok_or("ar offset overflow")?;
        let header = bytes.get(offset..header_end).ok_or("truncated ar header")?;
        if &header[58..] != b"`\n" {
            return Err("invalid ar header".into());
        }
        let text = std::str::from_utf8(&header[48..58])
            .map_err(|_| "invalid ar length")?
            .trim();
        if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
            return Err("invalid ar length".into());
        }
        let size: usize = text.parse().map_err(|_| "invalid ar length")?;
        let end = header_end.checked_add(size).ok_or("ar length overflow")?;
        let mut member = bytes.get(header_end..end).ok_or("truncated ar member")?;
        let mut name = std::str::from_utf8(&header[..16])
            .map_err(|_| "invalid ar name")?
            .trim();
        if let Some(n) = name.strip_prefix("#1/") {
            let n: usize = n.parse().map_err(|_| "invalid BSD ar name")?;
            name = std::str::from_utf8(member.get(..n).ok_or("invalid BSD ar name")?)
                .map_err(|_| "invalid BSD ar name")?
                .trim_end_matches('\0');
            member = member.get(n..).ok_or("invalid BSD ar name")?;
        }
        let index = matches!(
            name,
            "/" | "//" | "/SYM64/" | "__.SYMDEF" | "__.SYMDEF SORTED"
        );
        if !index {
            if member.len() < 64 || &member[..4] != b"\x7fELF" {
                return Err(format!("non-ELF object in native archive: {name}"));
            }
            if member[4..7] != [2, 1, 1]
                || u16::from_le_bytes([member[16], member[17]]) != 1
                || u16::from_le_bytes([member[18], member[19]]) != 183
                || u32::from_le_bytes([member[20], member[21], member[22], member[23]]) != 1
            {
                return Err(format!(
                    "non-AArch64 ELF64 relocatable in native archive: {name}"
                ));
            }
            objects += 1;
        }
        offset = end.checked_add(size % 2).ok_or("ar padding overflow")?;
        if offset > bytes.len() {
            return Err("missing ar padding".into());
        }
    }
    if objects == 0 {
        return Err("native archive has no AArch64 objects".into());
    }
    Ok(objects)
}

fn required_env(name: &str) -> Result<PathBuf, String> {
    println!("cargo:rerun-if-env-changed={name}");
    env::var_os(name).filter(|v| !v.is_empty()).map(PathBuf::from).ok_or_else(|| {
        format!("{name} is required for the real Android native build; see docs/android-arm64.md. No host-library fallback is permitted.")
    })
}

fn require_file(path: &Path) -> Result<(), String> {
    if path.is_file() {
        println!("cargo:rerun-if-changed={}", path.display());
        Ok(())
    } else {
        Err(format!("Android build input missing: {}", path.display()))
    }
}

fn require_archive(path: &Path) -> Result<(), String> {
    require_file(path)?;
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    inspect_archive(&bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(())
}

fn run(command: &mut Command) -> Result<(), String> {
    let status = command.status().map_err(|e| format!("{command:?}: {e}"))?;
    if !status.success() {
        return Err(format!("{command:?} failed: {status}"));
    }
    Ok(())
}

pub fn build(source: &Path, out: &Path, wx: Option<&str>) -> Result<(), String> {
    validate_target(&env::var("TARGET").unwrap_or_default())?;
    let ndk = required_env("ANDROID_NDK_HOME")?;
    let prefix = required_env("NEXUS_ANDROID_PREFIX")?;
    let flang = required_env("NEXUS_ANDROID_FLANG")?;
    require_file(&flang)?;
    require_file(&ndk.join("build/cmake/android.toolchain.cmake"))?;
    require_file(&prefix.join("include/fftw3.f03"))?;
    require_file(&prefix.join("include/boost/crc.hpp"))?;
    for name in ["libfftw3f.a", "libflang_rt.runtime.a"] {
        require_archive(&prefix.join("lib").join(name))?;
    }
    let host = if cfg!(windows) {
        "windows-x86_64"
    } else if cfg!(target_os = "macos") {
        "darwin-x86_64"
    } else {
        "linux-x86_64"
    };
    let ndk_libs = ndk
        .join("toolchains/llvm/prebuilt")
        .join(host)
        .join("sysroot/usr/lib/aarch64-linux-android");
    for name in ["libc++_static.a", "libc++abi.a"] {
        require_archive(&ndk_libs.join(name))?;
    }
    let toolchain = source.join("android-arm64.cmake");
    require_file(&toolchain)?;
    let mut configure = Command::new("cmake");
    configure
        .arg("-S")
        .arg(source)
        .arg("-B")
        .arg(out)
        .args(["-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release"])
        .arg(format!("-DCMAKE_TOOLCHAIN_FILE={}", toolchain.display()))
        .arg(format!("-DANDROID_NDK={}", ndk.display()))
        .arg(format!("-DNEXUS_ANDROID_PREFIX={}", prefix.display()))
        .arg(format!("-DNEXUS_ANDROID_FLANG={}", flang.display()))
        .arg(format!("-DANDROID_PLATFORM=android-{API}"));
    if let Some(wx) = wx {
        configure.arg(format!("-DWX={wx}"));
    }
    run(&mut configure)?;
    run(Command::new("cmake").arg("--build").arg(out).args([
        "--target",
        "tempo_static",
        "--parallel",
    ]))?;
    // Validate what CMake produced too; naming a directory "android" proves nothing.
    require_archive(&out.join("libtempo.a"))?;
    for dir in [out.to_path_buf(), prefix.join("lib"), ndk_libs] {
        println!("cargo:rustc-link-search=native={}", dir.display());
    }
    for lib in [
        "tempo",
        "fftw3f",
        "flang_rt.runtime",
        "c++_static",
        "c++abi",
    ] {
        println!("cargo:rustc-link-lib=static={lib}");
    }
    for lib in ["m", "dl"] {
        println!("cargo:rustc-link-lib={lib}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn elf(machine: u16) -> Vec<u8> {
        let mut b = vec![0; 64];
        b[..7].copy_from_slice(b"\x7fELF\x02\x01\x01");
        b[16..18].copy_from_slice(&1_u16.to_le_bytes());
        b[18..20].copy_from_slice(&machine.to_le_bytes());
        b[20..24].copy_from_slice(&1_u32.to_le_bytes());
        b
    }
    fn member(name: &str, bytes: &[u8]) -> Vec<u8> {
        let header = format!(
            "{name:<16}{:<12}{:<6}{:<6}{:<8}{:<10}`\n",
            0,
            0,
            0,
            644,
            bytes.len()
        );
        let mut out = header.into_bytes();
        out.extend_from_slice(bytes);
        if bytes.len() % 2 != 0 {
            out.push(b'\n');
        }
        out
    }
    fn archive(members: &[Vec<u8>]) -> Vec<u8> {
        let mut out = b"!<arch>\n".to_vec();
        for member in members {
            out.extend_from_slice(member);
        }
        out
    }
    #[test]
    fn only_the_actual_android_arm64_target_is_admitted() {
        assert!(validate_target(TARGET).is_ok());
        for other in [
            "aarch64-unknown-linux-gnu",
            "aarch64-pc-windows-msvc",
            "armv7-linux-androideabi",
            "x86_64-linux-android",
            "",
        ] {
            assert!(validate_target(other).is_err(), "{other}");
        }
    }
    #[test]
    fn positive_control_counts_real_shaped_arm64_members() {
        assert_eq!(
            inspect_archive(&archive(&[
                member("one.o/", &elf(183)),
                member("two.o/", &elf(183))
            ])),
            Ok(2)
        );
    }
    #[test]
    fn symbols_and_gnu_long_names_do_not_count_as_objects() {
        assert_eq!(
            inspect_archive(&archive(&[
                member("/", b"symbols"),
                member("//", b"long-name.o/\n"),
                member("/0", &elf(183))
            ])),
            Ok(1)
        );
        assert!(inspect_archive(&archive(&[member("/", b"symbols")])).is_err());
    }
    #[test]
    fn bsd_extended_names_are_supported() {
        let mut body = b"long-name.o".to_vec();
        body.extend_from_slice(&elf(183));
        assert_eq!(inspect_archive(&archive(&[member("#1/11", &body)])), Ok(1));
    }
    #[test]
    fn wrong_architecture_and_mixed_archives_are_rejected() {
        for machine in [62, 40, 3, 0] {
            assert!(inspect_archive(&archive(&[member("wrong.o/", &elf(machine))])).is_err());
            assert!(inspect_archive(&archive(&[
                member("arm.o/", &elf(183)),
                member("wrong.o/", &elf(machine))
            ]))
            .is_err());
        }
    }
    #[test]
    fn windows_objects_or_metadata_cannot_hide_behind_one_arm64_object() {
        for bytes in [
            b"MZbinary".as_slice(),
            b"\x64\x86\x02\x00",
            b"rust metadata",
        ] {
            assert!(inspect_archive(&archive(&[
                member("arm.o/", &elf(183)),
                member("other.o/", bytes)
            ]))
            .is_err());
        }
    }
    #[test]
    fn malformed_and_empty_archives_are_rejected() {
        for bytes in [
            b"".as_slice(),
            b"MZ",
            b"!<thin>\n",
            b"!<arch>\n",
            b"!<arch>\nshort",
        ] {
            assert!(inspect_archive(bytes).is_err());
        }
        let mut truncated = archive(&[member("one.o/", &elf(183))]);
        truncated.pop();
        assert!(inspect_archive(&truncated).is_err());
    }
    #[test]
    fn only_little_endian_elf64_relocatables_are_admitted() {
        for (at, value) in [(4, 1), (5, 2), (6, 0), (16, 2), (20, 0)] {
            let mut bytes = elf(183);
            bytes[at] = value;
            assert!(inspect_archive(&archive(&[member("bad.o/", &bytes)])).is_err());
        }
    }
}
