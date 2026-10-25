import assert from 'node:assert/strict';
import fs from 'node:fs';
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

const good = `Nexus gates — current workflow
ran 2  passed 2  failed 0  skipped 0
SELECTED GATES PASSED — all 2 of them.
SCOPED to --job test-tauri: other jobs were NOT run.
every gate that ran:
  PASS  exit 0  Rust src-tauri + native Remote :: actual test (00-test.log)
  PASS  exit 0  Rust src-tauri + native Remote :: actual lint (01-lint.log)
`;
test('scope acceptance rejects omitted work, unknown steps, missing dependencies and missing logs', () => {
  verifySummary(good);
  for (const bad of [
    '', good.replace('ran 2  passed 2  failed 0  skipped 0', 'ran 0  passed 0  failed 0  skipped 0'),
    good.replace('skipped 0', 'skipped 1'), good.replace('failed 0', 'failed 1'),
    good + '  UNKNOWN  unsupported workflow step\n',
    good + '  UNCONFIRMED DEPENDENCY  rigctld missing\n',
    good + 'PARTIAL — a selected step did not execute\n',
    good.replace('  PASS  exit 0  Rust src-tauri + native Remote :: actual lint (01-lint.log)\n', ''),
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
