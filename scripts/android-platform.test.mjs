// Source-boundary regression guards, not Android execution or complete-backend evidence.
// The previous cloud backend compiled the runtime cfg! branches and failed on the
// Windows-only APIs. The actual target cargo check remains the compilation gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, 'src-tauri', 'src', name), 'utf8');
const remote = read('remote_window.rs');
const login = read('login_start.rs');
const station = read('lib.rs');
const client = read('client_mode.rs');

function remoteBoundary(source, name, endMarker) {
  const start = source.indexOf(`pub async fn ${name}(`);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0 && end > start, 'Missing actual remote-window command');
  const command = source.slice(start, end);
  assert.doesNotMatch(command, /if\s+!cfg!\(windows\)/);
  assert.match(command, /#\[cfg\(not\(windows\)\)\][\s\S]*?Err\(UNAVAILABLE\.into\(\)\)/);
  const windows = command.indexOf('#[cfg(windows)]');
  assert(windows > command.indexOf('Err(UNAVAILABLE.into())'));
  assert(windows < command.indexOf('.unminimize()'));
  assert(windows < command.indexOf('WebviewWindowBuilder::new'));
  assert.match(command.slice(windows), /\.on_navigation\(/);
  assert.match(command.slice(windows), /NewWindowResponse::Deny/);
}

for (const [name, end] of [
  ['open_remote_stations_window', '/// The loopback origin'],
  ['open_lan_stations_window', '/// F11 for the window'],
]) {
  test(`${name}: existing Windows-only behavior is compile-time isolated`, () => {
    remoteBoundary(remote, name, end);
    // Negative controls mutate the actual source being checked, not a spare fixture.
    const start = remote.indexOf(`pub async fn ${name}(`);
    const prefix = remote.slice(0, start);
    const commandAndRest = remote.slice(start);
    assert.throws(() => remoteBoundary(prefix + commandAndRest.replace(
      '#[cfg(windows)]', 'if cfg!(windows)'), name, end));
    assert.throws(() => remoteBoundary(prefix + commandAndRest.replace(
      'Err(UNAVAILABLE.into())', 'Ok(())'), name, end));
  });
}

test('login adapter has real desktop implementation and explicit mobile refusal', () => {
  assert.match(login, /#\[cfg\(desktop\)\]\s*let builder = builder\.plugin\(tauri_plugin_autostart::Builder/);
  assert.match(login, /#\[cfg\(desktop\)\]\s*\{\s*use tauri_plugin_autostart::ManagerExt/);
  assert.match(login, /launcher\.enable\(\)/);
  assert.match(login, /launcher\.disable\(\)/);
  assert.match(login, /#\[cfg\(mobile\)\]\s*\{\s*let _ = \(app, on\);\s*Err\("launchAtLoginUnsupported"\.to_string\(\)\)/);
});

test('both callers apply OS changes before writing preferences and use the shared installer', () => {
  for (const source of [station, client]) {
    assert.doesNotMatch(source, /tauri_plugin_autostart::(?:ManagerExt|Builder)/);
    assert.match(source, /login_start::install\(tauri::Builder::default\(\)\)/);
  }
  const command = station.slice(station.indexOf('fn set_launch_at_login('),
    station.indexOf('fn answer_remote_autostart_offer('));
  const os = command.indexOf('login_start::set(&app, on)?;');
  assert(os >= 0 && os < command.indexOf('let mut eng = engine_lock'));
  const local = client.slice(client.indexOf('fn launch_at_login<'), client.indexOf('fn fed('));
  const clientOs = local.indexOf('crate::login_start::set(app, on)?;');
  assert(clientOs >= 0 && clientOs < local.indexOf('self.local(Local::LaunchAtLogin'));
});
