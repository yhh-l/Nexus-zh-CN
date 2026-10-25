import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { dependencies, verifySummary } from './native-ci-scope.mjs';

const workflow = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
test('native setup is extracted from actual CI, including changes rather than a copied list', () => {
  const script = dependencies(workflow);
  assert.match(script, /libhamlib-utils/);
  assert.match(script, /libwebkit2gtk-4\.1-dev/);
  const changed = workflow.replace(/(  test-tauri:[\s\S]*?libhamlib-utils)/, '$1 EXTRA_DEPENDENCY_CONTROL');
  assert.match(dependencies(changed), /EXTRA_DEPENDENCY_CONTROL/);
  assert.throws(() => dependencies(workflow.replace('  test-tauri:\n', '  missing-native-job:\n')));
  assert.throws(() => dependencies(workflow.replace(/(  test-tauri:[\s\S]*?)Install libtempo build dependencies/, '$1changed setup')));
});

// Generate the positive control with the actual gate runner. A hand-written summary had
// one space where the real runner emits two, so it never tested the real wire format.
function actualPassingSummary() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-ci-summary-'));
  const source = path.join(tmp, 'workflow.yml');
  fs.writeFileSync(source, `name: scoped-positive-control
on: [push]
jobs:
  test-tauri:
    name: Rust src-tauri + native Remote
    runs-on: ubuntu-latest
    steps:
      - name: actual test
        run: echo first-control-ran
      - name: actual lint
        run: echo second-control-ran
  unrelated:
    runs-on: ubuntu-latest
    steps:
      - name: not selected
        run: echo not-selected
`);
  const env = { ...process.env, GATES_LOG_DIR: path.join(tmp, 'logs') };
  delete env.NODE_TEST_CONTEXT;
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync(process.execPath,
    [path.join(root, 'scripts/gates'), '--workflow', source, '--job', 'test-tauri', '--allow-partial'],
    { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const summaryPath = result.stdout.match(/^summary: (.+)$/m)?.[1];
  assert(summaryPath, 'Actual gate runner must produce its named summary');
  const summary = fs.readFileSync(summaryPath, 'utf8');
  assert.match(summary, /^ran 2  passed 2  failed 0  skipped 0$/m);
  return summary;
}
test('scope acceptance rejects omitted work, unknown steps, missing dependencies and missing logs', () => {
  const good = actualPassingSummary();
  verifySummary(good);
  for (const bad of [
    '', good.replace('ran 2  passed 2  failed 0  skipped 0', 'ran 0  passed 0  failed 0  skipped 0'),
    good.replace('skipped 0', 'skipped 1'), good.replace('failed 0', 'failed 1'),
    good + '  UNKNOWN  unsupported workflow step\n',
    good + '  UNCONFIRMED DEPENDENCY  rigctld missing\n',
    good + 'PARTIAL — a selected step did not execute\n',
    good.replace(/^  PASS  exit 0  .+ :: .+  \(.+\.log\)\n/m, ''),
    good.replace('SCOPED to --job test-tauri:', 'SCOPED to --job test:'),
  ]) assert.throws(() => verifySummary(bad));
});

test('runner.temp is evaluated in step context, never unsupported job env', () => {
  const source = fs.readFileSync(new URL('../.github/workflows/android-native-regression.yml', import.meta.url), 'utf8');
  function contextGuard(text) {
    assert.doesNotMatch(text, /^    env:\n(?:      .+\n)*?      GATES_LOG_DIR:.*runner\.temp/m);
    assert.match(text, /^        env:\n          GATES_LOG_DIR: \$\{\{ runner\.temp \}\}\/native-ci-gates$/m);
  }
  contextGuard(source);
  assert.throws(() => contextGuard(source.replace(
    '        env:\n          GATES_LOG_DIR:', '    env:\n      GATES_LOG_DIR:')));
});
