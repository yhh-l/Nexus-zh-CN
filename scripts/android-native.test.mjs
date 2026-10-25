// Host-side tests of the REAL Android dispatch and toolchain configuration. Fixture
// toolchain inputs below are never used to claim a native build or an Android runtime.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { modemOutput, inspectSharedObject, neededLibraries, inspectFftwArchive, FFTW_LEGACY_SYMBOLS } from './android-native-link.mjs';

import { OPENSSL_SOURCE, opensslTargetEnvironment, opensslLinkArguments } from './android-openssl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-android-native-'));
const EXT = process.platform === 'win32' ? '.exe' : '';
const GUARDS = path.join(TEMP, `archive-tests${EXT}`);
const BUILDER = path.join(TEMP, `modem-build${EXT}`);
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: ROOT, encoding: 'utf8', timeout: 120_000, ...options });
  if (result.error) throw result.error;
  return { ...result, output: `${result.stdout}${result.stderr}` };
}
before(() => {
  for (const [file, output, flags] of [
    ['android_build.rs', GUARDS, ['--test']], ['build.rs', BUILDER, []],
  ]) {
    const result = run('rustc', ['--edition=2021', ...flags, path.join(ROOT, 'crates', 'tempo-fast-sys', file), '-o', output]);
    assert.equal(result.status, 0, result.output);
  }
});
after(() => fs.rmSync(TEMP, { recursive: true, force: true }));
function androidEnv(extra = {}) {
  const env = { ...process.env, CARGO_MANIFEST_DIR: path.join(ROOT, 'crates', 'tempo-fast-sys'),
    CARGO_CFG_TARGET_OS: 'android', TARGET: 'aarch64-linux-android', OUT_DIR: TEMP };
  for (const name of ['ANDROID_NDK_HOME', 'NEXUS_ANDROID_PREFIX', 'NEXUS_ANDROID_FLANG', 'WX']) delete env[name];
  return { ...env, ...extra };
}

test('the standalone native archive tests all execute and pass', () => {
  const result = run(GUARDS, []);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /8 passed; 0 failed/);
});
test('actual Cargo build script admits Android then refuses absent NDK without a host fallback', () => {
  const result = run(BUILDER, [], { env: androidEnv() });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ANDROID_NDK_HOME is required/);
  assert.doesNotMatch(result.output, /Configuring done|Built target tempo_static/);
});
test('Linux ARM64 does not satisfy the Android target admission', () => {
  const result = run(BUILDER, [], { env: androidEnv({ TARGET: 'aarch64-unknown-linux-gnu' }) });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /currently targets aarch64-linux-android/);
});
test('actual Cargo build script rejects a host archive before running CMake', () => {
  const root = path.join(TEMP, 'foreign-archive');
  const ndk = path.join(root, 'ndk');
  const prefix = path.join(root, 'prefix');
  const flang = path.join(root, 'flang');
  for (const [name, text] of [
    [flang, 'not executed'], [path.join(ndk, 'build', 'cmake', 'android.toolchain.cmake'), '# not executed'],
    [path.join(prefix, 'include', 'fftw3.f03'), '! fixture'], [path.join(prefix, 'include', 'boost', 'crc.hpp'), '// fixture'],
    [path.join(prefix, 'lib', 'libfftw3f.a'), 'MZdesktop-library'],
  ]) { fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, text); }
  const result = run(BUILDER, [], { env: androidEnv({ ANDROID_NDK_HOME: ndk, NEXUS_ANDROID_PREFIX: prefix, NEXUS_ANDROID_FLANG: flang }) });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /libfftw3f.a: not a regular ar archive/);
});
function configureToolchain({ ndkExists = true, compilerExists = true, api = 35 } = {}) {
  const root = fs.mkdtempSync(path.join(TEMP, 'cmake-'));
  const ndk = path.join(root, 'ndk');
  const flang = path.join(root, 'flang');
  if (ndkExists) {
    const filename = path.join(ndk, 'build', 'cmake', 'android.toolchain.cmake');
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, 'set(CMAKE_SYSROOT "fixture-sysroot")\n');
  }
  if (compilerExists) fs.writeFileSync(flang, 'not executed');
  const normalize = (filename) => filename.split(path.sep).join('/');
  const script = path.join(root, 'check.cmake');
  fs.writeFileSync(script, `
set(ANDROID_NDK "${normalize(ndk)}")
set(NEXUS_ANDROID_FLANG "${normalize(flang)}")
set(ANDROID_PLATFORM "android-${api}")
include("${normalize(path.join(ROOT, 'libtempo', 'android-arm64.cmake'))}")
if(NOT ANDROID_ABI STREQUAL "arm64-v8a" OR NOT ANDROID_STL STREQUAL "c++_static")
  message(FATAL_ERROR "wrong Android ABI or C++ runtime")
endif()
if(NOT CMAKE_Fortran_COMPILER_TARGET STREQUAL "aarch64-linux-android35")
  message(FATAL_ERROR "Fortran target not Android API 35")
endif()
if(NOT CMAKE_POSITION_INDEPENDENT_CODE OR NOT CMAKE_TRY_COMPILE_TARGET_TYPE STREQUAL "STATIC_LIBRARY")
  message(FATAL_ERROR "non-PIC or target executable probe")
endif()
if(DEFINED CMAKE_Fortran_COMPILER_WORKS)
  message(FATAL_ERROR "compiler-success detection must not be forged")
endif()
message(STATUS "Android toolchain configuration verified; no code compiled")
`);
  return run('cmake', ['-P', script]);
}
test('positive control: real toolchain file chooses Android target, PIC and static STL', () => {
  const result = configureToolchain();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /configuration verified; no code compiled/);
});
for (const [label, options, expected] of [
  ['missing NDK', { ndkExists: false }, /ANDROID_NDK must name/],
  ['missing Flang', { compilerExists: false }, /NEXUS_ANDROID_FLANG must name/],
  ['different API', { api: 34 }, /requires ANDROID_PLATFORM=android-35/],
]) {
  test(`toolchain refuses ${label}`, () => {
    const result = configureToolchain(options);
    assert.notEqual(result.status, 0);
    assert.match(result.output, expected);
  });
}

function sharedObject(alignment = 16384n, machine = 183) {
  const bytes = Buffer.alloc(120);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  bytes.writeUInt16LE(3, 16); bytes.writeUInt16LE(machine, 18); bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(64n, 32); bytes.writeUInt16LE(64, 52); bytes.writeUInt16LE(56, 54); bytes.writeUInt16LE(1, 56);
  bytes.writeUInt32LE(1, 64); bytes.writeBigUInt64LE(alignment, 64 + 48);
  return bytes;
}
test('positive control: AArch64 shared library has actual 16 KiB load alignment', () => {
  assert.deepEqual(inspectSharedObject(sharedObject()), { machine: 'AArch64', bits: 64, loadSegments: 1, minimumPageAlignment: 16384 });
});
test('shared-library guard rejects wrong arch, 4 KiB pages and truncated headers', () => {
  for (const bytes of [sharedObject(4096n), sharedObject(16384n, 62), sharedObject().subarray(0, 90), Buffer.from('MZ')]) {
    assert.throws(() => inspectSharedObject(bytes));
  }
  const noLoads = sharedObject(); noLoads.writeUInt32LE(0, 64);
  assert.throws(() => inspectSharedObject(noLoads), /no load/);
});
test('desktop or unbundled C++ runtimes cannot become Android modem dependencies', () => {
  assert.deepEqual(neededLibraries('0x01 (NEEDED) Shared library: [libc.so]\n0x01 (NEEDED) Shared library: [libm.so]'), ['libc.so', 'libm.so']);
  for (const lib of ['libc.so.6', 'libgfortran.so.5', 'libstdc++.so.6', 'libc++_shared.so']) {
    assert.throws(() => neededLibraries(`0x01 (NEEDED) Shared library: [${lib}]`), /Unexpected/);
  }
  assert.throws(() => neededLibraries(''), /No dynamic dependency/);
});
test('native linking uses the actual Cargo build-script output, not the first matching file', () => {
  const out = path.join(ROOT, 'target', 'android-native-cargo', 'aarch64-linux-android', 'debug', 'build', 'tempo-fast-sys-fingerprint', 'out');
  const records = [{ reason: 'compiler-artifact', manifest_path: path.join(ROOT, 'crates', 'tempo-fast-sys', 'Cargo.toml'),
    target: { kind: ['custom-build'] }, package_id: 'modem-id' },
    { reason: 'build-script-executed', package_id: 'modem-id', out_dir: out }];
  assert.equal(modemOutput(records), path.join(out, 'libtempo.a'));
  assert.throws(() => modemOutput(records.slice(0, 1)), /Expected one real/);
  records[1].out_dir = path.join(ROOT, 'target', 'debug', 'host-build', 'out');
  assert.throws(() => modemOutput(records), /not in the Android/);
});
test('native bootstraps pin upstream inputs and never forge a compiler-success result', () => {
  const bootstrap = fs.readFileSync(path.join(ROOT, 'scripts', 'build-android-native.sh'), 'utf8');
  assert.match(bootstrap, /4633a23617fa31a3ea51242586ea7fb1da7140e426bd62fc164261fe036aa142/);
  assert.match(bootstrap, /56c932549852cddcfafdab3820b0200c7742675be92179e59e6215b340e26467/);
  assert.match(bootstrap, /sha256sum -c -/);
  assert.match(bootstrap, /--target=aarch64-linux-android35/);
  assert.doesNotMatch(bootstrap, /CMAKE_Fortran_COMPILER_WORKS|\|\| true|--allow-unauthenticated/);
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'android-arm64.yml'), 'utf8');
  assert.match(workflow, /--features radio,yaesu-wf/);
  assert.doesNotMatch(workflow, /NEXUS_ALLOW_MISSING_AICW|--no-default-features/);
});
test('FFTW bootstrap validates the installed interface, not an absent source-tree file', () => {
  const prefix = path.join(TEMP, 'fftw-installed');
  const include = path.join(prefix, 'include');
  const script = path.join(ROOT, 'scripts', 'build-android-native.sh');
  fs.mkdirSync(include, { recursive: true });
  const check = () => run('bash', [script, '--check-fftw-interface', prefix]);
  const missing = check();
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.output, /make install did not produce/);
  // A template beside the real include path cannot satisfy the installed-file guard.
  fs.writeFileSync(path.join(include, 'fftw3.f03.in'), '! fixture template\n');
  assert.equal(check().status, 1);
  const installed = path.join(include, 'fftw3.f03');
  fs.writeFileSync(installed, '');
  assert.equal(check().status, 1);
  // This is a file-existence guard fixture, not Fortran or Android build evidence.
  fs.writeFileSync(installed, '! synthetic installed interface fixture\n');
  const present = check();
  assert.equal(present.status, 0, present.output);
  const bootstrap = fs.readFileSync(script, 'utf8');
  assert.doesNotMatch(bootstrap, /install[^\n]*\$fftw\/api\/fftw3\.f03/);
  assert.match(bootstrap, /require_fftw_interface "\$NEXUS_ANDROID_PREFIX"/);
});

// Synthetic ELF headers exercise the refusal/positive-control paths only.
// They are never build artifacts or evidence of a working Android FFTW library.
function fftwArchiveFixture(machine = 183) {
  const object = Buffer.alloc(64);
  object.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  object.writeUInt16LE(1, 16);
  object.writeUInt16LE(machine, 18);
  object.writeUInt32LE(1, 20);
  const header = 'fftw.o/'.padEnd(16) + '0'.padEnd(12) + '0'.padEnd(6) +
    '0'.padEnd(6) + '100644'.padEnd(8) + String(object.length).padEnd(10) + '`\n';
  return Buffer.concat([Buffer.from('!<arch>\n'), Buffer.from(header), object]);
}
function fftwSymbolsFixture() {
  return FFTW_LEGACY_SYMBOLS.map((name) => `${name} T 0 10`).join('\n');
}
test('FFTW ABI positive control requires actual AArch64 members and every legacy definition', () => {
  const result = inspectFftwArchive(fftwArchiveFixture(), fftwSymbolsFixture());
  assert.equal(result.elfObjects, 1);
  assert.deepEqual(result.legacySymbols, [...FFTW_LEGACY_SYMBOLS]);
});
test('FFTW ABI guard reports each missing definition instead of waiting for a modem link failure', () => {
  for (const name of FFTW_LEGACY_SYMBOLS) {
    for (const replacement of ['', `${name} U`, `${name} t 0 10`, `${name}_ T 0 10`]) {
      const symbols = fftwSymbolsFixture().replace(`${name} T 0 10`, replacement);
      assert.throws(() => inspectFftwArchive(fftwArchiveFixture(), symbols), (error) => {
        assert.match(error.message, /legacy Fortran ABI is incomplete/);
        assert(error.message.includes(name));
        assert.match(error.message, /--enable-fortran/);
        return true;
      });
    }
  }
  assert.throws(() => inspectFftwArchive(fftwArchiveFixture(), 'fftwf_execute T 0 10'), /sfftw_execute_/);
});
test('FFTW ABI guard cannot approve a foreign archive just because its symbol names look correct', () => {
  assert.throws(() => inspectFftwArchive(fftwArchiveFixture(62), fftwSymbolsFixture()), /other than ELF64/);
  assert.throws(() => inspectFftwArchive(Buffer.from('MZ'), fftwSymbolsFixture()), /not a regular ar archive/);
});
test('Android FFTW bootstrap enables the real wrappers and checks them before building the runtime', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'build-android-native.sh'), 'utf8');
  assert.match(source, /--enable-neon --enable-fortran/);
  assert.doesNotMatch(source, /--disable-fortran/);
  const check = source.indexOf('node "$root/scripts/android-native-link.mjs" --check-fftw');
  assert(check >= 0 && check < source.indexOf('cmake -S "$llvm/runtimes"'));
});

test('full Android backend stages the existing hash-pinned AI CW model without a missing-model override', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'android-arm64.yml'), 'utf8');
  const desktopCi = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  // The reviewed model lives upstream, not on every fork's Releases page.
  const requireModelOrigin = source => assert.match(source,
    /gh release download deepcw-model-v1 --repo kd9taw\/Nexus/);
  requireModelOrigin(desktopCi);
  assert.throws(() => requireModelOrigin(desktopCi.replace(
    'deepcw-model-v1 --repo kd9taw/Nexus',
    'deepcw-model-v1 --repo "${{ github.repository }}"')));
  const modelStep = workflow.indexOf('- name: Stage and verify the real AI CW model');
  const backendStep = workflow.indexOf('- name: Check the full application backend');
  assert(modelStep >= 0 && modelStep < backendStep);
  const staging = workflow.slice(modelStep, backendStep);
  assert.match(staging, /curl --fail --show-error --location --retry 3 --proto '=https'/);
  assert.match(staging, /https:\/\/github\.com\/kd9taw\/Nexus\/releases\/download\/deepcw-model-v1/);
  assert.match(staging, /test -s "\$directory\/LICENSE\.AGPL-3\.0\.txt"/);
  assert.match(staging, /for file in model\.onnx model\.onnx\.json/);
  for (const hash of [
    'a7b3b4aa2610d3e88b8c7d4420eceee31be2d0ae595b3413264334f3ffb1eab5',
    'b4342157b90229ee7380e165f3d8036179b80d1e6ae02f2557388b7fcd558c01',
  ]) {
    assert(staging.includes(hash), 'Android model digest changed');
    assert(desktopCi.includes(hash), 'Android model differs from the reviewed desktop model');
  }
  assert.equal((staging.match(/\| sha256sum -c -/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /NEXUS_ALLOW_MISSING_AICW/);
});

test('OpenSSL discovery is target-scoped and cannot redirect host build dependencies', () => {
  const prefix = path.join(TEMP, 'android-openssl-prefix');
  assert.deepEqual(opensslTargetEnvironment(prefix), {
    AARCH64_LINUX_ANDROID_OPENSSL_DIR: prefix,
    AARCH64_LINUX_ANDROID_OPENSSL_STATIC: '1',
  });
  assert.throws(() => opensslTargetEnvironment('relative-prefix'), /absolute single-line/);
  assert.throws(() => opensslTargetEnvironment(`${prefix}\nOPENSSL_DIR=host`), /absolute single-line/);
});
test('OpenSSL link probe covers both whole target archives and refuses unresolved symbols', () => {
  const prefix = path.join(TEMP, 'openssl');
  const output = path.join(TEMP, 'probe.so');
  const args = opensslLinkArguments(prefix, output);
  assert.equal(args[0], '--target=aarch64-linux-android35');
  assert(args.includes('-Wl,--no-undefined'));
  assert(args.includes('-Wl,-z,max-page-size=16384'));
  assert(args.includes('-Wl,-z,common-page-size=16384'));
  const start = args.indexOf('-Wl,--whole-archive');
  const end = args.indexOf('-Wl,--no-whole-archive');
  assert.deepEqual(args.slice(start + 1, end), [path.join(prefix, 'lib', 'libssl.a'), path.join(prefix, 'lib', 'libcrypto.a')]);
  assert.deepEqual(args.slice(-2), ['-o', output]);
  assert(!args.some(arg => /allow-shlib-undefined|unresolved-symbols=ignore|libssl\.so|libcrypto\.so/.test(arg)));
});
test('OpenSSL bootstrap pins source, uses NDK Android API 35 and never permits host pkg-config fallback', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'build-android-openssl.sh'), 'utf8');
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'android-arm64.yml'), 'utf8');
  assert(source.includes(`openssl-${OPENSSL_SOURCE.version}.tar.gz`));
  assert(source.includes(OPENSSL_SOURCE.sha256));
  assert.match(source, /sha256sum -c -/);
  assert.match(source, /export ANDROID_NDK_ROOT="\$ANDROID_NDK_HOME"/);
  assert.match(source, /CC=clang AR=llvm-ar RANLIB=llvm-ranlib/);
  assert.match(source, /android-arm64 -D__ANDROID_API__=35 -fPIC no-shared/);
  assert.match(source, /make -j2 build_libs/);
  assert.match(source, /make install_dev/);
  assert.match(source, /node "\$root\/scripts\/android-openssl\.mjs"/);
  assert.doesNotMatch(source, /PKG_CONFIG_ALLOW_CROSS=|apt-get.*libssl-dev|--cross-compile-prefix=/);
  const stage = workflow.indexOf('run: bash scripts/build-android-openssl.sh');
  const backend = workflow.indexOf('- name: Check the full application backend');
  assert(stage >= 0 && stage < backend);
});

test('real APK code generation follows the full backend gate and cannot distribute a checkpoint as an APK', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/android-arm64.yml'), 'utf8');
  const build = fs.readFileSync(path.join(ROOT, 'scripts/build-android-apk.sh'), 'utf8');
  const syntax = run('bash', ['-n', 'scripts/build-android-apk.sh']);
  assert.equal(syntax.status, 0, syntax.output);
  assert.match(build, /GITHUB_ACTIONS/);
  assert.match(build, /cargo tauri android build --ci --target aarch64 --apk --features radio,yaesu-wf -- --locked/);
  assert.match(build, /git diff --exit-code -- Cargo.lock src-tauri\/Cargo.lock src-tauri\/gen\/android/);
  assert.match(build, /gradle-wrapper.jar \| sha256sum -c -/);
  assert.doesNotMatch(build, /--debug|--no-default-features|NEXUS_ALLOW_MISSING|--ignore-version-mismatches|--no-verify|apksigner|jarsigner|git push/);
  const stage = workflow.indexOf('run: bash scripts/build-android-apk.sh');
  const backend = workflow.indexOf('- name: Check the full application backend');
  assert(stage > backend && backend >= 0);
  const tail = workflow.slice(stage);
  assert.match(tail, /path: target\/android-apk\/build-report.json/);
  assert.doesNotMatch(tail, /path:.*\.(apk|aab)|path:.*outputs/);
});
