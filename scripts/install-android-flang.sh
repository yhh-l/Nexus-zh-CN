#!/usr/bin/env bash
# Build-time host compiler only, on an ephemeral Ubuntu 24.04 runner. No app key,
# personal credential, publish operation or Android runtime is installed by this file.
set -euo pipefail
[[ "$(uname -s)" == Linux ]] || { echo 'LLVM host setup requires Linux' >&2; exit 2; }
work="${RUNNER_TEMP:-/tmp}/nexus-llvm21"
mkdir -p "$work"
curl --fail --show-error --silent --location --retry 3 --proto '=https' \
  https://apt.llvm.org/llvm-snapshot.gpg.key -o "$work/llvm.asc"
printf '%s  %s\n' 8b2a587ffd672c4687e7581dad4b2f6c1bb2ad6b480cd9771ba2ff48e0b8c75d "$work/llvm.asc" | sha256sum -c -
sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/nexus-llvm21.gpg "$work/llvm.asc"
printf '%s\n' 'deb [signed-by=/usr/share/keyrings/nexus-llvm21.gpg] https://apt.llvm.org/noble/ llvm-toolchain-noble-21 main' \
  | sudo tee /etc/apt/sources.list.d/nexus-llvm21.list >/dev/null
sudo apt-get update
sudo apt-get install -y --no-install-recommends flang-21 cmake ninja-build libboost-dev
# The target runtime sources are pinned to exactly 21.1.8; stop rather than mix ABIs.
compiler="$(command -v flang-new-21 || command -v flang-21)"
"$compiler" --version > "$work/flang-version.txt"
grep -F '21.1.8' "$work/flang-version.txt" >/dev/null || {
  cat "$work/flang-version.txt" >&2
  echo 'The pinned LLVM runtime requires a 21.1.8 frontend; review a version change first.' >&2
  exit 1
}
if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'NEXUS_ANDROID_FLANG=%s\n' "$compiler" >> "$GITHUB_ENV"
fi
