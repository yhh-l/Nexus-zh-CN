// Android host configuration contract, not a build or permission to ship an APK.
// Tauri utils 2.9.3 config/parse.rs uses RFC 7396 before deserializing Config:
// platform arrays replace base arrays; null resource entries REMOVE map keys.
// Original implementation; no upstream source is copied here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function mergePatch(base, patch) {
  if (!record(patch)) return structuredClone(patch);
  const result = record(base) ? structuredClone(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else Object.defineProperty(result, key, {
      value: mergePatch(result[key], value), enumerable: true, writable: true, configurable: true,
    });
  }
  return result;
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function verifyHostConfig(base, android) {
  requireValue(android.identifier === base.identifier, 'Android must preserve the application identifier');
  requireValue(JSON.stringify(android.plugins) === JSON.stringify(base.plugins),
    'Host preparation must not change service, credential or updater-key configuration');
  requireValue(JSON.stringify(android.build) === JSON.stringify(base.build),
    'Android must retain the complete existing UI build');
  const windows = android.app?.windows;
  requireValue(Array.isArray(windows) && windows.length === 1, 'Android requires one main webview, not a desktop splash window');
  const main = windows[0];
  requireValue(main.label === 'main' && main.visible === true, 'The Android main webview must be visible');
  requireValue(main.url === 'android-start.html', 'Do not start the engine UI before the logbook is attached');
  requireValue(main.minWidth == null && main.minHeight == null, 'Do not inherit desktop minimum window geometry');
  requireValue(android.bundle?.android?.minSdkVersion === 35, 'Android minSdkVersion must match the initial native API-35 baseline');
  requireValue(android.bundle?.createUpdaterArtifacts === false, 'Desktop updater installers are not Android packages');
  requireValue(android.bundle?.externalBin == null || android.bundle.externalBin.length === 0,
    'Android must not inherit desktop sidecar executables');
  const resources = android.bundle?.resources;
  requireValue(record(resources), 'Android resources must remain a source-to-target map');
  requireValue(Object.values(resources).every(value => typeof value === 'string'), 'Resource deletion markers must be merged out');
  for (const [source, destination] of Object.entries(resources)) {
    requireValue(![source, destination].some(value => /hamlib|\.(?:exe|dll|dylib)(?:$|[/*])|\.so\.[0-9]/i.test(value)),
      'Desktop Hamlib or foreign runtime resource declarations are forbidden on Android');
  }
  for (const [source, destination] of Object.entries(base.bundle.resources)) {
    if (source === 'resources/hamlib/*' || source === '../licenses/rust/THIRD-PARTY.txt') continue;
    requireValue(resources[source] === destination, 'Android must preserve existing model, data and license resources');
  }
  requireValue(!Object.hasOwn(resources, '../licenses/rust/THIRD-PARTY.txt') &&
    resources['../target/android-notices/RUST-THIRD-PARTY.txt'] === 'resources/rust/THIRD-PARTY.txt',
    'Android must replace desktop Rust notices with the generated target inventory');
  for (const file of ['LICENSE.txt', 'NOTICE.txt']) {
    const source = `../licenses/android-jvm/kotlinx-coroutines-1.9.0/${file}`;
    requireValue(resources[source] === `resources/android-jvm/kotlinx-coroutines-1.9.0/${file}`,
      'Android must preserve scoped JVM supplemental notice resources');
  }
  requireValue(JSON.stringify(android.app.security) === JSON.stringify(base.app.security),
    'Host preparation must not relax existing webview security or asset scopes');
  return {
    milestone: 'android-host-config-contract', intendedTarget: 'aarch64-linux-android', minSdkVersion: 35,
    mainWindow: 'main', startupPage: main.url, resourceDeclarationsChecked: true,
    tauriSchemaValidated: false, androidHostGenerated: false, nativeCodeCompiled: false,
    resourcePayloadsInspected: false, apkProduced: false, deviceTested: false,
  };
}

export function inspectHostConfig(root = ROOT) {
  const basePath = path.join(root, 'src-tauri', 'tauri.conf.json');
  const patchPath = path.join(root, 'src-tauri', 'tauri.android.conf.json');
  const baseBytes = fs.readFileSync(basePath);
  const patchBytes = fs.readFileSync(patchPath);
  const base = JSON.parse(baseBytes.toString('utf8'));
  const patch = JSON.parse(patchBytes.toString('utf8'));
  const android = mergePatch(base, patch);
  const result = verifyHostConfig(base, android);
  requireValue(fs.statSync(path.join(root, 'ui', 'public', result.startupPage)).isFile(), 'Android startup asset is missing');
  return { ...result, sourceHashes: {
    desktop: crypto.createHash('sha256').update(baseBytes).digest('hex'),
    android: crypto.createHash('sha256').update(patchBytes).digest('hex'),
  } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.env.GITHUB_ACTIONS === 'true', 'Run this port verification in GitHub Actions, not on the local machine');
    const output = path.join(ROOT, 'target', 'android-host', 'config-report.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.rmSync(output, { force: true });
    const report = inspectHostConfig();
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    console.log('Source/config contract only: no generated Android project, native build or APK claim.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
