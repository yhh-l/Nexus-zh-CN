#!/usr/bin/env bash
# Cloud-only target build. Never point openssl-sys at Ubuntu's libssl-dev.
# OpenSSL 3.5.9: upstream release, Apache-2.0; original headers remain intact.
set -euo pipefail
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
  echo 'Android OpenSSL bootstrap requires the Linux x86_64 GitHub runner.' >&2; exit 2;
}
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
: "${ANDROID_NDK_HOME:?Run the Android native bootstrap first}"
: "${NEXUS_ANDROID_PREFIX:?Run the Android native bootstrap first}"
export ANDROID_NDK_ROOT="$ANDROID_NDK_HOME"
ndkbin="$ANDROID_NDK_ROOT/toolchains/llvm/prebuilt/linux-x86_64/bin"
[[ -x "$ndkbin/clang" && -f "$ANDROID_NDK_ROOT/source.properties" ]] || {
  echo 'Expected the real Android NDK toolchain, not a host compiler.' >&2; exit 1;
}
export PATH="$ndkbin:$PATH"
work="$root/target/android-openssl"
mkdir -p "$work/downloads" "$work/build" "$NEXUS_ANDROID_PREFIX/licenses"
archive="$work/downloads/openssl-3.5.9.tar.gz"
if [[ ! -f "$archive" ]]; then
  curl --fail --show-error --location --retry 3 --proto '=https' \
    https://github.com/openssl/openssl/releases/download/openssl-3.5.9/openssl-3.5.9.tar.gz \
    -o "$archive.part"
  printf '%s  %s\n' 603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a "$archive.part" | sha256sum -c -
  mv -- "$archive.part" "$archive"
fi
printf '%s  %s\n' 603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a "$archive" | sha256sum -c -
if [[ ! -f "$work/openssl-3.5.9/.nexus-source-complete" ]]; then
  tar -xf "$archive" -C "$work"
  touch "$work/openssl-3.5.9/.nexus-source-complete"
fi
(
  cd "$work/build"
  # Upstream NOTES-ANDROID: explicit target/API, NDK clang on PATH, no guessed
  # GNU cross-prefix. Build real libraries; do not try to execute target tests
  # or install target command-line tools onto the Linux runner.
  CC=clang AR=llvm-ar RANLIB=llvm-ranlib perl "$work/openssl-3.5.9/Configure" \
    android-arm64 -D__ANDROID_API__=35 -fPIC no-shared no-tests \
    --prefix="$NEXUS_ANDROID_PREFIX" --libdir=lib
  make -j2 build_libs
  make install_dev
)
install -m644 "$work/openssl-3.5.9/LICENSE.txt" "$NEXUS_ANDROID_PREFIX/licenses/OpenSSL-LICENSE.txt"
# This validates actual target archive members, performs a strict whole-library
# NDK link and checks its ELF/dependencies. It is NOT a TLS handshake or APK test.
node "$root/scripts/android-openssl.mjs"
printf '%s\n' 'Target OpenSSL built and checked; TLS trust/handshake and device tests remain outstanding.'
