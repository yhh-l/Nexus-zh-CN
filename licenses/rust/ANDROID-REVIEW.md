# Android Rust missing-text provenance (2026-10-25)

Scope: nine missing package license bodies reported by the actual locked Android
Rust graph in Actions run 40187645097, job 121151730865. This is notice-text
preparation, NOT a complete source-file, native-runtime, Java/AAR or APK audit.
No implementation source, binary, dependency version or desktop election changes.

`android-upstream.json` supplements the desktop inventory only in the Android
notice generator. Each imported text is preserved, UTF-8/LF normalized as in the
existing generator, SHA256-pinned and attributed to its immutable source URL.
The existing text fingerprint and published VCS-commit checks remain active.
Android pins cannot replace desktop records; obsolete Android pins fail generation.

Per-file license-body review:

- `android-jni-rs-jni-5ae9458-LICENSE-MIT` and
  `android-jni-rs-macros-33045a1-LICENSE-MIT`: complete MIT texts, copyright
  2016 Prevoty, Inc. and jni-rs contributors; respectively the exact published
  JNI 0.22.4 and jni-macros 0.22.4 VCS revisions reported by Cargo.
- `android-jni-sys-macros-64d77b7-LICENSE-MIT`: complete MIT text, copyright
  2015 The rust-jni-sys Developers, exact jni-sys-macros 0.4.1 VCS revision.
- `android-ndk-49bbbba-LICENSE-MIT` and
  `android-ndk-context-10f2ba3-LICENSE-MIT`: complete MIT texts as published
  (neither text has a copyright line; none invented), exact Cargo VCS revisions
  for ndk 0.9.0 / ndk-sys 0.6.0+11769913 and ndk-context 0.1.1 respectively.
- `android-rustls-da3d9c3-LICENSE-MIT`: complete MIT text, copyright 2022
  1Password. Commit da3d9c36f48fb9f8f97e94f132fdab67ab0fc75b is the upstream
  `android-release-support: v0.1.0 -> 0.1.1` commit; its Cargo.toml matches the
  published Rust support crate's identity/version/license. The crate lacks VCS
  metadata. This does NOT establish provenance or license closure of its generated
  Maven/AAR payload: that remains a separate required Java/native review.
- `android-tao-macros-340684d-LICENSE`: complete Apache-2.0 text from the commit
  of `tao-macros-v0.1.3`, 340684d932b6126bed449fc1f4edca81776ad592. The package
  declares MIT OR Apache-2.0 but has no body; that release repository's LICENSE
  and SPDX record declare Apache-2.0, NOT an MIT body. Elect the declared Apache
  alternative for this exact Android package, subject to deny.toml, and preserve
  the whole text. Do not manufacture an MIT grant. This text is not proof of
  source-file-wide audit or a claim of any template's application to every file.
- `android-rust-2014-LICENSE-MIT`: complete Rust 0.12.0 MIT license, copyright
  2014 The Rust Project Developers, from immutable release commit
  ba4081a5a8573875fed17545846f6f6902c8ba8d. cesu8 1.1.0 has no license body even
  in its own release repository; its own src/lib.rs and src/unicode.rs headers
  explicitly offer the Rust MIT/Apache choice. Use the steward's MIT body,
  retaining cesu8's additional attribution in the next file rather than claiming
  Rust's copyright covers Eric Kidd.
- `android-cesu8-COPYRIGHT-header`: verbatim first nine lines (comment header
  only) of cesu8 src/lib.rs at f18962a9de5189f21600b7ff2898845157df4447, the
  upstream `v1.1.0` version commit. Copyright 2012-2014 The Rust Project Developers
  and Eric Kidd; MIT OR Apache-2.0 (MIT selected). This is an attributed excerpt,
  not a full-source copy or standalone replacement for the MIT body above.

The three packages without VCS metadata were read from their locked registry
archives; SHA256 independently matched src-tauri/Cargo.lock:

- cesu8 1.1.0: 6d43a04d8753f35258c91f8ec639f792891f748a1edbd759cf1dcea3382ad83c
- rustls-platform-verifier-android 0.1.1: f87165f0995f63a9fbeea62b64d10b4d9d8e78ec6d7d51fb2125fda7bb36788f
- tao-macros 0.1.3: f4e16beb8b2ac17db28eab8bca40e62dbfbb34c0fcdc6d9826b11b7b5d047dfd

The elected MIT and Apache-2.0 alternatives are allowed by the project's existing
GPL-3.0-only policy. The authors' grants/disclaimers remain intact. All runtime
notice/source-completeness and distributability flags remain false. No signing,
installability, physical-phone, audio, USB/CAT or transmit claim follows.
