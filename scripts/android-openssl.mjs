#!/usr/bin/env node
// Actual Android OpenSSL archive/link evidence, NOT a TLS or credential change.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectArchive, ROOT, TARGET } from './android-arm64.mjs';
import { inspectSharedObject, neededLibraries } from './android-native-link.mjs';

export const OPENSSL_SOURCE = Object.freeze({
  version: '3.5.9',
  sha256: '603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a',
});
export function opensslTargetEnvironment(prefix) {
  if (!path.isAbsolute(prefix) || /[\r\n]/.test(prefix)) throw new Error('OpenSSL prefix must be an absolute single-line path');
  return { AARCH64_LINUX_ANDROID_OPENSSL_DIR: prefix, AARCH64_LINUX_ANDROID_OPENSSL_STATIC: '1' };
}
export function opensslLinkArguments(prefix, output) {
  return [
    '--target=aarch64-linux-android35', '-shared', '-fPIC',
    '-Wl,--no-undefined', '-Wl,-z,max-page-size=16384', '-Wl,-z,common-page-size=16384',
    '-Wl,--whole-archive', path.join(prefix, 'lib', 'libssl.a'),
    path.join(prefix, 'lib', 'libcrypto.a'), '-Wl,--no-whole-archive',
    '-lm', '-ldl', '-o', output,
  ];
}
function run(program, args) {
  const result = spawnSync(program, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited ${result.status}\n${result.stdout}${result.stderr}`);
  return result.stdout;
}
export function checkOpenSsl() {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Android OpenSSL check requires the Linux x86_64 runner');
  const prefix = process.env.NEXUS_ANDROID_PREFIX;
  const ndk = process.env.ANDROID_NDK_HOME;
  if (!prefix || !ndk) throw new Error('NEXUS_ANDROID_PREFIX and ANDROID_NDK_HOME are required');
  opensslTargetEnvironment(prefix);
  const output = path.join(ROOT, 'target', 'android-openssl');
  const report = path.join(output, 'link-report.json');
  fs.mkdirSync(output, { recursive: true });
  fs.rmSync(report, { force: true });
  const sourceArchive = fs.readFileSync(path.join(output, 'downloads', `openssl-${OPENSSL_SOURCE.version}.tar.gz`));
  if (createHash('sha256').update(sourceArchive).digest('hex') !== OPENSSL_SOURCE.sha256) {
    throw new Error('OpenSSL source archive does not match the pinned upstream release');
  }
  const archives = Object.fromEntries(['libssl.a', 'libcrypto.a'].map((name) => {
    const bytes = fs.readFileSync(path.join(prefix, 'lib', name));
    return [name, { ...inspectArchive(bytes), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
  }));
  for (const file of ['include/openssl/ssl.h', 'include/openssl/crypto.h', 'licenses/OpenSSL-LICENSE.txt']) {
    if (fs.statSync(path.join(prefix, file)).size === 0) throw new Error(`Empty target OpenSSL input: ${file}`);
  }
  const bin = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', 'linux-x86_64', 'bin');
  const library = path.join(output, 'libnexus_openssl_probe.so');
  run(path.join(bin, 'clang'), opensslLinkArguments(prefix, library));
  const bytes = fs.readFileSync(library);
  const result = {
    schemaVersion: 1, milestone: 'android-openssl-whole-library-link', target: TARGET, api: 35,
    source: OPENSSL_SOURCE, archives, ...inspectSharedObject(bytes),
    neededLibraries: neededLibraries(run(path.join(bin, 'llvm-readelf'), ['--dynamic-table', library])),
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    tlsHandshakeTested: false, deviceTrustStoreTested: false,
    fullApplicationBuilt: false, apkProduced: false, deviceTested: false,
  };
  fs.writeFileSync(report, `${JSON.stringify(result, null, 2)}\n`);
  // Only Android-target discovery changes; HOST build dependencies keep their
  // own environment. No certificate, cipher or credential setting is touched.
  if (process.env.GITHUB_ENV) {
    for (const [name, value] of Object.entries(opensslTargetEnvironment(prefix))) {
      fs.appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
    }
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkOpenSsl(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
