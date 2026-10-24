#!/usr/bin/env bash
# Real Android/NDK dependency builds, never ARM64 GNU/Linux prebuilt libraries.
# Only build dependencies under target/. Does not install an APK or enable RF.
# LLVM source provenance: official llvmorg-21.1.8 release, Apache-2.0 WITH LLVM-exception.
# FFTW provenance: upstream 3.3.10 tarball, GPL-2.0-or-later (already used by Nexus).
set -euo pipefail
# FFTW generates fftw3.f03 in the out-of-tree BUILD directory and make install
# installs it. The release tarball has api/fftw3.f03.in, not api/fftw3.f03.
# Validation-only mode lets cloud regression tests exercise this actual guard
# without downloading or compiling dependencies.
require_fftw_interface() {
  [[ -s "$1/include/fftw3.f03" ]] || {
    echo 'FFTW make install did not produce a nonempty include/fftw3.f03' >&2
    return 1
  }
}
if [[ "${1:-}" == --check-fftw-interface && "$#" == 2 ]]; then
  require_fftw_interface "$2"
  exit 0
fi
[[ "$#" == 0 ]] || { echo 'Unexpected bootstrap arguments' >&2; exit 2; }
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
  echo 'This bootstrap currently requires the Linux x86_64 GitHub runner.' >&2; exit 2;
}
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
work="$root/target/android-native-deps"
export NEXUS_ANDROID_PREFIX="$work/prefix"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-${ANDROID_NDK_LATEST_HOME:-}}}"
: "${ANDROID_NDK_HOME:?An installed Android NDK is required}"
: "${NEXUS_ANDROID_FLANG:?Run scripts/install-android-flang.sh first}"
ndkbin="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin"
sysroot="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/sysroot"
[[ -f "$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake" && -d "$sysroot/usr/lib/aarch64-linux-android/35" ]] || {
  echo 'NDK toolchain or API 35 target libraries missing; do not use host libraries.' >&2; exit 1;
}
[[ -f /usr/include/boost/crc.hpp ]] || { echo 'Install libboost-dev for header-only CRC' >&2; exit 1; }
mkdir -p "$work/downloads" "$NEXUS_ANDROID_PREFIX/include" "$NEXUS_ANDROID_PREFIX/lib"
"$NEXUS_ANDROID_FLANG" --version > "$work/flang-version.txt"
grep -F '21.1.8' "$work/flang-version.txt" >/dev/null || { echo 'Flang/runtime version mismatch' >&2; exit 1; }

fetch() {
  local url="$1" hash="$2" output="$work/downloads/$3"
  if [[ ! -f "$output" ]]; then
    curl --fail --show-error --location --retry 3 --proto '=https' "$url" -o "$output.part"
    printf '%s  %s\n' "$hash" "$output.part" | sha256sum -c -
    mv -- "$output.part" "$output"
  fi
  printf '%s  %s\n' "$hash" "$output" | sha256sum -c -
}
fetch https://github.com/llvm/llvm-project/releases/download/llvmorg-21.1.8/llvm-project-21.1.8.src.tar.xz \
  4633a23617fa31a3ea51242586ea7fb1da7140e426bd62fc164261fe036aa142 llvm-project-21.1.8.src.tar.xz
fetch https://www.fftw.org/fftw-3.3.10.tar.gz \
  56c932549852cddcfafdab3820b0200c7742675be92179e59e6215b340e26467 fftw-3.3.10.tar.gz
llvm="$work/llvm-project-21.1.8.src"
fftw="$work/fftw-3.3.10"
# Re-extract incomplete source trees from the verified archives; no recursive deletion.
if [[ ! -f "$llvm/.nexus-source-complete" ]]; then
  tar -xf "$work/downloads/llvm-project-21.1.8.src.tar.xz" -C "$work"
  touch "$llvm/.nexus-source-complete"
fi
if [[ ! -f "$fftw/.nexus-source-complete" ]]; then
  tar -xf "$work/downloads/fftw-3.3.10.tar.gz" -C "$work"
  touch "$fftw/.nexus-source-complete"
fi
# Do not put /usr/include on Android's include path. Only Boost's reviewed,
# architecture-independent headers are exposed through the isolated prefix.
if [[ ! -e "$NEXUS_ANDROID_PREFIX/include/boost" ]]; then
  ln -s /usr/include/boost "$NEXUS_ANDROID_PREFIX/include/boost"
fi
export CC_aarch64_linux_android="$ndkbin/aarch64-linux-android35-clang"
export CXX_aarch64_linux_android="$ndkbin/aarch64-linux-android35-clang++"
export AR_aarch64_linux_android="$ndkbin/llvm-ar"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$CC_aarch64_linux_android"
export CMAKE_TOOLCHAIN_FILE_aarch64_linux_android="$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake"
# Prove the host frontend can actually emit an Android-targeted ARM64 object.
cat > "$work/frontend-probe.f90" <<'FORTRAN'
subroutine nexus_android_frontend_probe() bind(C)
end subroutine
FORTRAN
"$NEXUS_ANDROID_FLANG" --target=aarch64-linux-android35 --sysroot="$sysroot" \
  -fPIC -c "$work/frontend-probe.f90" -o "$work/frontend-probe.o"
"$ndkbin/llvm-readelf" --file-header "$work/frontend-probe.o" > "$work/frontend-probe.txt"
grep -F AArch64 "$work/frontend-probe.txt" >/dev/null

mkdir -p "$work/fftw-build"
(
  cd "$work/fftw-build"
  CC="$CC_aarch64_linux_android" AR="$AR_aarch64_linux_android" RANLIB="$ndkbin/llvm-ranlib" \
    CFLAGS='-O3 -fPIC' "$fftw/configure" --host=aarch64-linux-android \
      --prefix="$NEXUS_ANDROID_PREFIX" --enable-float --enable-static --disable-shared \
      --with-pic --enable-neon --disable-fortran --disable-doc
  make -j2
  make install
)
require_fftw_interface "$NEXUS_ANDROID_PREFIX"
cmake -S "$llvm/runtimes" -B "$work/flang-build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-35 -DANDROID_STL=c++_static \
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY \
  -DCMAKE_Fortran_COMPILER="$NEXUS_ANDROID_FLANG" \
  -DCMAKE_Fortran_COMPILER_TARGET=aarch64-linux-android35 \
  -DCMAKE_Fortran_FLAGS="--sysroot=$sysroot -fPIC" \
  -DLLVM_ENABLE_RUNTIMES=flang-rt -DLLVM_INCLUDE_TESTS=OFF \
  -DFLANG_RT_INCLUDE_TESTS=OFF -DFLANG_RT_ENABLE_STATIC=ON -DFLANG_RT_ENABLE_SHARED=OFF
cmake --build "$work/flang-build" --target flang_rt.runtime --parallel 2
mapfile -t runtimes < <(find "$work/flang-build" -type f -name libflang_rt.runtime.a)
[[ "${#runtimes[@]}" == 1 ]] || { echo 'Expected exactly one compiled Android Flang runtime' >&2; exit 1; }
install -m644 "${runtimes[0]}" "$NEXUS_ANDROID_PREFIX/lib/libflang_rt.runtime.a"
# App bundles must carry the actual runtime licences before anything ships.
mkdir -p "$NEXUS_ANDROID_PREFIX/licenses"
install -m644 "$llvm/flang-rt/LICENSE.TXT" "$NEXUS_ANDROID_PREFIX/licenses/LLVM-Flang-runtime.txt"
install -m644 "$fftw/COPYING" "$NEXUS_ANDROID_PREFIX/licenses/FFTW.txt"
for notice in NOTICE NOTICE.toolchain; do
  if [[ -f "$ANDROID_NDK_HOME/$notice" ]]; then
    install -m644 "$ANDROID_NDK_HOME/$notice" "$NEXUS_ANDROID_PREFIX/licenses/Android-NDK-$notice.txt"
  fi
done

# These are local build paths only, not credentials. Never serialize the full environment.
if [[ -n "${GITHUB_ENV:-}" ]]; then
  for name in ANDROID_NDK_HOME NEXUS_ANDROID_PREFIX NEXUS_ANDROID_FLANG \
    CC_aarch64_linux_android CXX_aarch64_linux_android AR_aarch64_linux_android \
    CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER CMAKE_TOOLCHAIN_FILE_aarch64_linux_android; do
    printf '%s=%s\n' "$name" "${!name}" >> "$GITHUB_ENV"
  done
fi
printf '%s\n' 'Android dependencies built; this is not an APK or device validation.'
