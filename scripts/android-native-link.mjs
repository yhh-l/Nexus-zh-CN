#!/usr/bin/env node
// Link the REAL whole modem archive for Android, with no undefined symbols, and
// inspect the resulting ELF. This is a native-library milestone, NOT an APK.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inspectArchive, TARGET } from './android-arm64.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function modemOutput(messages, root = ROOT) {
  const manifest = path.join(root, 'crates', 'tempo-fast-sys', 'Cargo.toml');
  const ids = new Set(messages.filter((m) => m.reason === 'compiler-artifact' &&
    path.resolve(m.manifest_path ?? '.') === manifest && m.target?.kind?.includes('custom-build'))
    .map((m) => m.package_id));
  const dirs = [...new Set(messages.filter((m) => m.reason === 'build-script-executed' && ids.has(m.package_id)).map((m) => m.out_dir))];
  if (dirs.length !== 1 || typeof dirs[0] !== 'string') throw new Error('Expected one real modem build-script output');
  const base = path.join(root, 'target', 'android-native-cargo', TARGET, 'debug', 'build');
  const relative = path.relative(base, path.resolve(dirs[0]));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Modem output is not in the Android Cargo target tree');
  }
  return path.join(path.resolve(dirs[0]), 'libtempo.a');
}

export function inspectSharedObject(bytes) {
  if (bytes.length < 64 || !bytes.subarray(0, 7).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])) ||
      bytes.readUInt16LE(16) !== 3 || bytes.readUInt16LE(18) !== 183 || bytes.readUInt32LE(20) !== 1 || bytes.readUInt16LE(52) !== 64) {
    throw new Error('Expected a little-endian AArch64 ELF64 shared object');
  }
  const offset = bytes.readBigUInt64LE(32);
  const size = bytes.readUInt16LE(54);
  const count = bytes.readUInt16LE(56);
  if (size < 56 || offset > BigInt(bytes.length)) throw new Error('Invalid ELF program header table');
  let loads = 0;
  for (let i = 0; i < count; i++) {
    const at = Number(offset) + size * i;
    if (at + size > bytes.length) throw new Error('Truncated ELF program headers');
    if (bytes.readUInt32LE(at) !== 1) continue;
    const alignment = bytes.readBigUInt64LE(at + 48);
    const fileOffset = bytes.readBigUInt64LE(at + 8);
    const address = bytes.readBigUInt64LE(at + 16);
    const fileSize = bytes.readBigUInt64LE(at + 32);
    const memorySize = bytes.readBigUInt64LE(at + 40);
    if (fileSize > memorySize || fileOffset + fileSize > BigInt(bytes.length)) throw new Error('Invalid ELF load segment extent');
    if (alignment < 16384n || (alignment & (alignment - 1n)) !== 0n || fileOffset % alignment !== address % alignment) {
      throw new Error('Native shared object is not 16 KiB load-segment aligned');
    }
    loads++;
  }
  if (loads === 0) throw new Error('Shared object has no load segments');
  return { machine: 'AArch64', bits: 64, loadSegments: loads, minimumPageAlignment: 16384 };
}

export function neededLibraries(readelfOutput) {
  const libraries = [...readelfOutput.matchAll(/\(NEEDED\).*?\[([^\]]+)\]/g)].map((m) => m[1]);
  if (libraries.length === 0) throw new Error('No dynamic dependency evidence from llvm-readelf');
  const allowed = new Set(['libc.so', 'libm.so', 'libdl.so']);
  for (const library of libraries) {
    if (!allowed.has(library)) throw new Error(`Unexpected Android modem dependency: ${library}`);
  }
  return libraries;
}
function run(program, args) {
  const result = spawnSync(program, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited ${result.status}\n${result.stdout}${result.stderr}`);
  return result.stdout;
}
// These exact legacy symbols are called by the real four2a.f90 modem, unlike
// the separate FFTW3 ISO_C_BINDING interface installed as fftw3.f03.
export const FFTW_LEGACY_SYMBOLS = Object.freeze([
  'sfftw_destroy_plan_', 'sfftw_plan_dft_1d_', 'sfftw_plan_dft_r2c_1d_',
  'sfftw_execute_', 'sfftw_plan_dft_c2r_1d_',
]);
export function inspectFftwArchive(bytes, nmOutput) {
  const archive = inspectArchive(bytes);
  // llvm-nm --format=posix --defined-only --extern-only: name type value size.
  // An undefined, local, double-underscored or similarly named symbol is NOT
  // an implementation of the ABI our actual Flang-compiled modem requests.
  const definitions = new Set(nmOutput.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\S+)\s+T\s+[0-9a-fA-F]+(?:\s|$)/);
    return match ? [match[1]] : [];
  }));
  const missing = FFTW_LEGACY_SYMBOLS.filter((name) => !definitions.has(name));
  if (missing.length) {
    throw new Error(`Android FFTW legacy Fortran ABI is incomplete: missing ${missing.join(', ')}. ` +
      'Rebuild the NDK static FFTW library with --enable-fortran; fftw3.f03 alone is not an implementation. ' +
      'Do not substitute a desktop library or allow unresolved modem symbols.');
  }
  return { ...archive, legacySymbols: [...FFTW_LEGACY_SYMBOLS] };
}
export function checkFftwArchive(archive, nm) {
  return inspectFftwArchive(fs.readFileSync(archive),
    run(nm, ['--format=posix', '--defined-only', '--extern-only', archive]));
}

export function linkModem(input = path.join(ROOT, 'target', 'android-native-build.jsonl')) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Native link probe currently requires the Linux x86_64 runner');
  const ndk = process.env.ANDROID_NDK_HOME;
  const prefix = process.env.NEXUS_ANDROID_PREFIX;
  if (!ndk || !prefix) throw new Error('ANDROID_NDK_HOME and NEXUS_ANDROID_PREFIX are required');
  const output = path.join(ROOT, 'target', 'android-native-linked');
  fs.mkdirSync(output, { recursive: true });
  const report = path.join(output, 'link-report.json');
  fs.rmSync(report, { force: true });
  const messages = fs.readFileSync(input, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
  if (!messages.some((m) => m.reason === 'build-finished' && m.success)) throw new Error('Native Cargo build has not succeeded');
  const archive = modemOutput(messages);
  const objects = inspectArchive(fs.readFileSync(archive)).elfObjects;
  const bin = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', 'linux-x86_64', 'bin');
  const fftw = checkFftwArchive(path.join(prefix, 'lib', 'libfftw3f.a'), path.join(bin, 'llvm-nm'));
  const library = path.join(output, 'libnexus_modem_probe.so');
  run(path.join(bin, 'clang++'), [
    '--target=aarch64-linux-android35', '-shared', '-fPIC', '-static-libstdc++',
    '-Wl,--no-undefined', '-Wl,-z,max-page-size=16384', '-Wl,-z,common-page-size=16384',
    '-Wl,--whole-archive', archive, '-Wl,--no-whole-archive',
    `-L${path.join(prefix, 'lib')}`, '-lfftw3f', '-lflang_rt.runtime', '-lm', '-ldl', '-o', library,
  ]);
  const bytes = fs.readFileSync(library);
  const result = {
    schemaVersion: 1, target: TARGET, api: 35, milestone: 'whole-modem-native-link',
    fullApplicationBuilt: false, apkProduced: false, deviceTested: false,
    fftw, sourceArchiveObjects: objects, ...inspectSharedObject(bytes),
    neededLibraries: neededLibraries(run(path.join(bin, 'llvm-readelf'), ['--dynamic-table', library])),
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  fs.writeFileSync(report, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--check-fftw') {
      if (process.argv.length !== 5) throw new Error('Usage: --check-fftw ARCHIVE LLVM_NM');
      console.log(JSON.stringify(checkFftwArchive(process.argv[3], process.argv[4]), null, 2));
    } else {
      linkModem(process.argv[2]);
    }
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
