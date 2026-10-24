import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, mergePatch, verifyHostConfig, inspectHostConfig } from './android-host-config.mjs';

const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const patch = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.android.conf.json'), 'utf8'));
const android = () => mergePatch(base, patch);

test('real Android overlay replaces desktop windows and removes only the desktop Hamlib resource', () => {
  const before = structuredClone(base);
  const merged = android();
  const report = inspectHostConfig();
  assert.equal(report.mainWindow, 'main');
  assert.equal(report.minSdkVersion, 35);
  assert.equal(report.apkProduced, false);
  assert.equal(report.nativeCodeCompiled, false);
  assert.equal(report.androidHostGenerated, false);
  assert.equal(report.tauriSchemaValidated, false);
  assert.equal(report.resourcePayloadsInspected, false);
  assert.equal(merged.app.windows.length, 1);
  assert.equal(Object.hasOwn(merged.bundle.resources, 'resources/hamlib/*'), false);
  assert.deepEqual(base, before, 'Platform merging must never mutate desktop settings');
  assert.deepEqual(Object.keys(merged.bundle.resources).sort(),
    Object.keys(base.bundle.resources).filter(key => key !== 'resources/hamlib/*').sort());
});

test('merge-patch null deletes keys, arrays replace and prototype-looking keys stay inert data', () => {
  assert.deepEqual(mergePatch({ one: { old: 1, keep: 2 }, list: [1, 2] },
    { one: { old: null, fresh: 3 }, list: [4] }), { one: { keep: 2, fresh: 3 }, list: [4] });
  const result = mergePatch({}, JSON.parse('{"__proto__":{"nexusPolluted":true}}'));
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal(result.__proto__.nexusPolluted, true);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal({}.nexusPolluted, undefined);
});

test('the actual desktop configuration cannot pass as the Android host', () => {
  assert.throws(() => verifyHostConfig(base, base), /one main webview/);
});

for (const [name, mutate, message] of [
  ['hidden main window', value => { value.app.windows[0].visible = false; }, /must be visible/],
  ['early application boot', value => { value.app.windows[0].url = 'index.html'; }, /before the logbook/],
  ['desktop minimum geometry', value => { value.app.windows[0].minWidth = 900; }, /desktop minimum/],
  ['second splash window', value => { value.app.windows.push({ label: 'splashscreen' }); }, /one main webview/],
  ['different native API baseline', value => { value.bundle.android.minSdkVersion = 24; }, /API-35/],
  ['desktop update artifacts', value => { value.bundle.createUpdaterArtifacts = true; }, /not Android packages/],
  ['desktop sidecar', value => { value.bundle.externalBin = ['rigctld.exe']; }, /desktop sidecar/],
  ['dropped AI CW model', value => { delete value.bundle.resources['resources/deepcw/*']; }, /model, data and license/],
  ['dropped license', value => { delete value.bundle.resources['../COPYING']; }, /model, data and license/],
  ['different application ID', value => { value.identifier += '.other'; }, /application identifier/],
  ['changed service config', value => { value.plugins = {}; }, /credential or updater-key/],
  ['relaxed webview security', value => { value.app.security = {}; }, /webview security/],
]) {
  test(`host contract rejects ${name}`, () => {
    const value = android();
    mutate(value);
    assert.throws(() => verifyHostConfig(base, value), message);
  });
}

for (const source of ['resources/hamlib/*', 'helpers/rigctl.exe', 'helpers/foreign.dll',
  'helpers/foreign.dylib', 'helpers/libc.so.6']) {
  test(`foreign resource declaration cannot hide behind a neutral destination: ${source}`, () => {
    const value = android();
    value.bundle.resources[source] = 'resources/helper';
    assert.throws(() => verifyHostConfig(base, value), /foreign runtime/);
  });
}
