import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { TARGET, PACKAGES, ROOT, buildArguments, inspectArchive, verifyArtifacts, build } from './android-arm64.mjs';

function elf(machine = 183) {
  const bytes = Buffer.alloc(64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  bytes.writeUInt16LE(1, 16);
  bytes.writeUInt16LE(machine, 18);
  bytes.writeUInt32LE(1, 20);
  return bytes;
}
function member(name, data) {
  const header = `${name.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'644'.padEnd(8)}${String(data.length).padEnd(10)}\x60\n`;
  return Buffer.concat([Buffer.from(header), data, ...(data.length % 2 ? [Buffer.from('\n')] : [])]);
}
function archive(...members) {
  return Buffer.concat([Buffer.from('!<arch>\n'), ...members]);
}
function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-android-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function artifacts(root) {
  return PACKAGES.map((name) => {
    const filename = path.join(root, 'target', 'android-arm64', TARGET, 'debug', `lib${name.replaceAll('-', '_')}.rlib`);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, archive(member('module.o/', elf())));
    return { reason: 'compiler-artifact', manifest_path: path.join(root, 'crates', name, 'Cargo.toml'),
      target: { name: name.replaceAll('-', '_'), kind: ['lib'] }, profile: { test: false }, filenames: [filename] };
  });
}

test('build explicitly targets Android, locked real libraries, no feature replacement', () => {
  const args = buildArguments(ROOT);
  assert.equal(args[args.indexOf('--target') + 1], TARGET);
  assert.ok(args.includes('--locked'));
  assert.ok(args.includes('--lib'));
  assert.equal(args.includes('--no-default-features'), false);
  assert.equal(args.includes('--features'), false);
  for (const name of PACKAGES) assert.ok(args.includes(name));
});
test('positive control: real-shaped AArch64 objects are counted, not just metadata', () => {
  assert.deepEqual(inspectArchive(archive(member('lib.rmeta/', Buffer.from('rust')), member('module.o/', elf()))),
    { elfObjects: 1, machine: 'AArch64', bits: 64 });
});
test('GNU long filenames are resolved', () => {
  assert.equal(inspectArchive(archive(member('//', Buffer.from('long-module-name.rcgu.o/\n')), member('/0', elf()))).elfObjects, 1);
});
test('BSD extended filenames are resolved', () => {
  const name = Buffer.from('long-module-name.o');
  assert.equal(inspectArchive(archive(member(`#1/${name.length}`, Buffer.concat([name, elf()])))).elfObjects, 1);
});
for (const [label, bytes] of [
  ['Windows executable', Buffer.from('MZnot-an-archive')],
  ['Linux x86_64 object', archive(member('module.o/', elf(62)))],
  ['32-bit ARM object', archive(member('module.o/', elf(40)))],
  ['metadata-only archive', archive(member('lib.rmeta/', Buffer.from('rust')))],
  ['empty archive', archive()],
  ['truncated ar header', Buffer.from('!<arch>\nshort')],
  ['truncated member', archive(member('module.o/', elf())).subarray(0, 85)],
  ['mixed ARM64 and COFF', archive(member('arm.o/', elf()), member('win.o/', Buffer.from([0x64, 0x86, 2, 0])))],
  ['unknown non-ELF object', archive(member('arm.o/', elf()), member('other.o/', Buffer.from('not ELF')))],
  ['bad GNU filename offset', archive(member('/99', elf()))],
  ['bad BSD filename length', archive(member('#1/999', elf()))],
  ['truncated ELF', archive(member('module.o/', elf().subarray(0, 20)))],
]) {
  test(`reject ${label}`, () => assert.throws(() => inspectArchive(bytes)));
}
test('reject big-endian ELF and executable instead of relocatable', () => {
  const big = elf(); big[5] = 2;
  assert.throws(() => inspectArchive(archive(member('module.o/', big))));
  const executable = elf(); executable.writeUInt16LE(2, 16);
  assert.throws(() => inspectArchive(archive(member('module.o/', executable))));
});
test('positive control: all three real artifact records produce checksums', (t) => {
  const root = sandbox(t);
  const report = verifyArtifacts(artifacts(root), root);
  assert.equal(report.length, PACKAGES.length);
  assert.ok(report.every((row) => row.elfObjects === 1 && /^[a-f0-9]{64}$/.test(row.sha256)));
});
test('missing package, test-only artifact or wrong manifest cannot pass', (t) => {
  const root = sandbox(t);
  const records = artifacts(root);
  assert.throws(() => verifyArtifacts(records.slice(1), root), /tempo-base/);
  records[0].profile.test = true;
  assert.throws(() => verifyArtifacts(records, root), /tempo-base/);
  records[0].profile.test = false;
  records[0].manifest_path = path.join(root, 'elsewhere', 'Cargo.toml');
  assert.throws(() => verifyArtifacts(records, root), /tempo-base/);
});
test('host output and target-directory prefix lookalikes are refused', (t) => {
  const root = sandbox(t);
  const records = artifacts(root);
  records[0].filenames = [path.join(root, 'target', 'debug', 'libtempo_base.rlib')];
  assert.throws(() => verifyArtifacts(records, root), /outside the Android/);
  records[0].filenames = [path.join(root, 'target', 'android-arm64', TARGET, 'debug-other', 'libtempo_base.rlib')];
  assert.throws(() => verifyArtifacts(records, root), /outside the Android/);
});
test('wrong-architecture bytes fail even inside the correct target directory', (t) => {
  const root = sandbox(t);
  const records = artifacts(root);
  fs.writeFileSync(records[0].filenames[0], archive(member('module.o/', elf(62))));
  assert.throws(() => verifyArtifacts(records, root), /AArch64/);
});
function fakeCargo(lines, exitCode = 0) {
  return () => spawn(process.execPath, ['-e', `console.log(${JSON.stringify(lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n'))}); process.exitCode = ${exitCode}`],
    { stdio: ['ignore', 'pipe', 'pipe'] });
}
test('successful build report never claims APK, full app or device verification', async (t) => {
  const root = sandbox(t);
  const result = await build(root, fakeCargo([...artifacts(root), { reason: 'build-finished', success: true }]));
  assert.equal(result.apkProduced, false);
  assert.equal(result.fullApplicationBuilt, false);
  assert.equal(result.deviceTested, false);
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'target', 'android-arm64', 'build-report.json')));
  assert.deepEqual(saved, result);
});
for (const [label, lines, code] of [
  ['nonzero exit', [{ reason: 'build-finished', success: true }], 7],
  ['missing completion', [], 0],
  ['malformed cargo output', ['not JSON'], 0],
  ['missing artifacts despite success', [{ reason: 'build-finished', success: true }], 0],
]) {
  test(`${label} fails and retires a previous success report`, async (t) => {
    const root = sandbox(t);
    const report = path.join(root, 'target', 'android-arm64', 'build-report.json');
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, '{}');
    await assert.rejects(build(root, fakeCargo(lines, code)));
    assert.equal(fs.existsSync(report), false);
  });
}
test('workflow is branch-scoped, read-only, pinned, and uploads libraries rather than APKs', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'android-arm64.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.ok(workflow.includes('  push:\n    branches: [codex/android-arm64]'));
  assert.doesNotMatch(workflow, /^  (pull_request|schedule):/m);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /secrets\.|contents: write/);
  assert.match(workflow, /rust-toolchain@[a-f0-9]{40}/);
  assert.match(workflow, /targets: aarch64-linux-android/);
  assert.match(workflow, /run: node scripts\/android-arm64.mjs/);
  assert.match(workflow, /run: node --test scripts\/android-arm64.test.mjs/);
  assert.match(workflow, /if-no-files-found: error/);
  for (const name of PACKAGES) assert.ok(workflow.includes(`lib${name.replaceAll('-', '_')}.rlib`));
});
