// Focused cloud verification of the complete native CI job, not a replacement for full CI.
// Commands remain derived by scripts/gates; even with an intentionally scoped run, missing
// selected steps or setup dependencies must never be accepted as a successful backend gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function dependencies(workflow) {
  const marker = '\n  test-tauri:\n';
  const start = workflow.indexOf(marker);
  assert(start >= 0, 'Native CI job missing');
  const rest = workflow.slice(start + marker.length);
  const next = rest.search(/^  [\w-]+:\s*$/m);
  const job = next < 0 ? rest : rest.slice(0, next);
  const setup = '      - name: Install libtempo build dependencies\n        run: |\n';
  const at = job.indexOf(setup);
  assert(at >= 0, 'Native dependency setup changed; review the source workflow');
  assert.equal(job.indexOf(setup, at + 1), -1, 'Ambiguous native dependency setup');
  const lines = job.slice(at + setup.length).split('\n');
  const script = [];
  for (const line of lines) {
    if (!line.startsWith('          ')) break;
    script.push(line.slice(10));
  }
  assert(script.length > 0, 'No native dependency setup extracted');
  return script.join('\n') + '\n';
}

export function verifySummary(summary) {
  const counts = [...summary.matchAll(/^ran (\d+)  passed (\d+)  failed (\d+)  skipped (\d+)$/gm)];
  assert.equal(counts.length, 1, 'Expected exactly one actual gate-count summary');
  const [, ran, passed, failed, skipped] = counts[0].map(Number);
  assert(ran > 0 && passed === ran && failed === 0 && skipped === 0,
    'Every selected native gate must actually run and pass');
  assert.doesNotMatch(summary, /^\s*(?:UNKNOWN\b|SKIPPED\b|UNCONFIRMED DEPENDENCY\b|PARTIAL\b)/m);
  assert.match(summary, /^SELECTED GATES PASSED — all \d+ of them\.$/m);
  assert.match(summary, /^SCOPED to --job test-tauri:/m);
  const results = [...summary.matchAll(/^  PASS  exit 0  .+ :: .+  \(.+\.log\)$/gm)];
  assert.equal(results.length, ran, 'Each passing selected gate needs its actual step log');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv[2] === '--dependencies') {
    process.stdout.write(dependencies(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')));
  } else if (process.argv[2] === '--verify' && process.argv[3]) {
    const logs = path.resolve(process.argv[3]);
    const summaries = fs.readdirSync(logs, { recursive: true }).filter(name => path.basename(name) === 'summary.txt');
    assert.equal(summaries.length, 1, 'Expected exactly one current scoped run summary');
    verifySummary(fs.readFileSync(path.join(logs, summaries[0]), 'utf8'));
    console.log('All selected native CI gates ran and passed; other CI jobs and Android runtime remain unproven.');
  } else {
    throw new Error('Use --dependencies or --verify <current-run-log-directory>');
  }
}
