#!/usr/bin/env node
// Android ARM64 portability milestone, NOT an APK builder. Compile the real, unmodified
// portable crates, then inspect the archive members rather than trusting a filename or a
// cargo exit code. No stub modem, desktop-library copying, signing key or TX change belongs here.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const TARGET = 'aarch64-linux-android';
export const PACKAGES = Object.freeze(['tempo-base', 'propagation', 'js8']);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildArguments(root = ROOT) {
  return [
    'build', '--locked', '--target', TARGET, '--lib',
    '--target-dir', path.join(root, 'target', 'android-arm64'),
    '--message-format=json-render-diagnostics',
    ...PACKAGES.flatMap((name) => ['--package', name]),
  ];
}

// Rust rlibs are regular ar archives. Metadata/index members are not ELF, but every
// ELF member must be a 64-bit, little-endian AArch64 relocatable object. This does NOT
// distinguish Android from GNU/Linux AArch64: provenance comes from the explicit Cargo
// target, not e_machine alone. Nothing here approves external/prebuilt native libraries.
export function inspectArchive(bytes) {
  if (bytes.subarray(0, 8).toString('ascii') !== '!<arch>\n') {
    throw new Error('not a regular ar archive');
  }
  let offset = 8;
  let objects = 0;
  let longNames;
  while (offset < bytes.length) {
    if (offset + 60 > bytes.length) throw new Error('truncated ar member header');
    const header = bytes.subarray(offset, offset + 60);
    if (header.subarray(58).toString('ascii') !== '`\n') throw new Error('invalid ar member header');
    const lengthText = header.subarray(48, 58).toString('ascii').trim();
    if (!/^\d+$/.test(lengthText)) throw new Error('invalid ar member length');
    const length = Number(lengthText);
    if (!Number.isSafeInteger(length) || offset + 60 + length > bytes.length) {
      throw new Error('truncated ar member');
    }
    let member = bytes.subarray(offset + 60, offset + 60 + length);
    // BSD extended filenames occupy the start of the member, unlike GNU string tables.
    let name = header.subarray(0, 16).toString('ascii').trim();
    if (name.startsWith('#1/')) {
      const nameLengthText = name.slice(3);
      if (!/^\d+$/.test(nameLengthText) || Number(nameLengthText) > member.length) {
        throw new Error('invalid BSD ar filename');
      }
      name = member.subarray(0, Number(nameLengthText)).toString('utf8').replace(/\0+$/, '');
      member = member.subarray(Number(nameLengthText));
    }
    if (name === '//') longNames = member;
    if (/^\/\d+$/.test(name)) {
      const index = Number(name.slice(1));
      if (!longNames || index >= longNames.length) throw new Error('invalid GNU ar filename');
      const end = longNames.indexOf('/\n', index);
      if (end < 0) throw new Error('unterminated GNU ar filename');
      name = longNames.subarray(index, end).toString('utf8');
    }
    if (member.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
      if (member.length < 64) throw new Error('truncated ELF64 header');
      if (member[4] !== 2 || member[5] !== 1 || member[6] !== 1 ||
          member.readUInt16LE(16) !== 1 || member.readUInt16LE(18) !== 183 ||
          member.readUInt32LE(20) !== 1) {
        throw new Error('archive contains an object other than ELF64 little-endian AArch64 relocatable');
      }
      objects += 1;
    } else if (!['/', '//', '/SYM64/', '__.SYMDEF', '__.SYMDEF SORTED'].includes(name) &&
               name.replace(/\/$/, '') !== 'lib.rmeta') {
      throw new Error(`archive contains a non-ELF object or unknown member: ${name}`);
    }
    const end = offset + 60 + length;
    offset = end + (length % 2);
    if (offset > bytes.length) throw new Error('missing ar padding');
  }
  if (objects === 0) throw new Error('archive has no AArch64 ELF objects');
  return { elfObjects: objects, machine: 'AArch64', bits: 64 };
}

export function verifyArtifacts(messages, root = ROOT) {
  const targetRoot = path.join(root, 'target', 'android-arm64', TARGET, 'debug');
  return PACKAGES.map((name) => {
    const manifest = path.join(root, 'crates', name, 'Cargo.toml');
    const artifacts = messages.filter((message) => message.reason === 'compiler-artifact' &&
      path.resolve(message.manifest_path ?? '.') === manifest &&
      message.target?.name === name.replaceAll('-', '_') &&
      message.target?.kind?.includes('lib') && !message.profile?.test);
    const filenames = [...new Set(artifacts.flatMap((message) => message.filenames ?? [])
      .filter((filename) => filename.endsWith('.rlib')))];
    if (filenames.length !== 1) throw new Error(`${name}: expected exactly one compiled rlib`);
    const filename = path.resolve(filenames[0]);
    const relative = path.relative(targetRoot, filename);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`${name}: artifact outside the Android target directory`);
    }
    const bytes = fs.readFileSync(filename);
    return {
      package: name, file: path.relative(root, filename).split(path.sep).join('/'),
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      ...inspectArchive(bytes),
    };
  });
}

export async function build(root = ROOT, spawnCargo = spawn) {
  const output = path.join(root, 'target', 'android-arm64');
  const report = path.join(output, 'build-report.json');
  fs.mkdirSync(output, { recursive: true });
  // A failed rerun must not leave our previous success report looking current.
  fs.rmSync(report, { force: true });
  const args = buildArguments(root);
  console.error(`cargo ${args.join(' ')}`);
  const child = spawnCargo('cargo', args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  const messages = [];
  let parseError;
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try { messages.push(JSON.parse(line)); }
    catch { parseError ??= new Error(`unexpected non-JSON cargo output: ${line.slice(0, 160)}`); }
  });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal) reject(new Error(`cargo terminated by ${signal}`));
      else resolve(code);
    });
  });
  if (code !== 0) throw new Error(`Android library compilation failed (cargo exit ${code})`);
  if (parseError) throw parseError;
  if (!messages.some((message) => message.reason === 'build-finished' && message.success === true)) {
    throw new Error('cargo did not report a successful build-finished event');
  }
  const result = {
    schemaVersion: 1, target: TARGET, milestone: 'portable-library-cross-build',
    fullApplicationBuilt: false, apkProduced: false, deviceTested: false,
    features: 'default features only; propagation/live is NOT built',
    artifacts: verifyArtifacts(messages, root),
    remaining: ['Tauri Android host', 'Fortran/FFTW/runtime cross-build',
      'complete logbook/backend dependency graph', 'USB/CAT/audio and lifecycle',
      'Android storage and service credentials', 'mobile UI', 'S25 Ultra device verification'],
  };
  fs.writeFileSync(report, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  console.error(`Report: ${report}\nThis is NOT an APK or a full Nexus Android build.`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('node scripts/android-arm64.mjs [--plan]\nRequires Rust 1.93.1 + rustup target add aarch64-linux-android.\nBuilds portable rlibs only, not an APK. No Android SDK/NDK needed at this milestone.');
  } else if (process.argv.slice(2).some((arg) => arg !== '--plan')) {
    console.error('Unknown argument; use --help.');
    process.exitCode = 2;
  } else if (process.argv.includes('--plan')) {
    console.log(JSON.stringify({ target: TARGET, packages: PACKAGES, command: ['cargo', ...buildArguments()], apkProduced: false }, null, 2));
  } else {
    build().catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
