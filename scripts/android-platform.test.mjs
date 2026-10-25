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

function storageBoundary(source, storage) {
  const start = source.indexOf('\npub fn run() {');
  assert(start >= 0, 'Actual mobile entry point must exist');
  const run = source.slice(start);
  const init = run.indexOf('android_storage::initialize()');
  for (const marker of ['tempo_core::applog::init(', 'Settings::load(', 'client_mode::requested()']) {
    assert(init >= 0 && init < run.indexOf(marker), `Private storage must precede ${marker}`);
  }
  assert.match(run, /if let Err\(error\) = android_storage::initialize\(\) \{[^}]*\{error\}[^}]*return;/);
  for (const method of ['config_base', 'local_data_dir']) {
    assert(source.includes(`#[cfg(all(not(test), target_os = "android"))]\nfn ${method}() -> PathBuf {\n    android_storage::${method}()`));
  }
  assert.match(storage, /wait_for_context\(main_android_context,/);
  assert.match(storage, /"getFilesDir"/);
  assert.match(storage, /StorageRoots::open\(&files_dir\)/);
  assert.doesNotMatch(storage, /std::env::(?:var|var_os|set_var)\(/);
}

test('Android roots use the real OS private directory before all station startup paths', () => {
  const storage = read('android_storage.rs');
  storageBoundary(station, storage);
  assert.throws(() => storageBoundary(station.replace('android_storage::initialize()', 'late_initialize()'), storage));
  assert.throws(() => storageBoundary(station.replace('android_storage::config_base()', 'PathBuf::from(".")'), storage));
  assert.throws(() => storageBoundary(station, storage.replace('StorageRoots::open(&files_dir)', 'StorageRoots::open(Path::new("."))')));
  assert.throws(() => storageBoundary(station, `${storage}\nstd::env::set_var("HOME", "fake");`));
});

// These guards constrain the real module graph. They do not substitute for Linux clippy or
// Android cargo check: both must still compile the complete backend in GitHub Actions.
function lanWindowBoundary(source) {
  for (const declaration of ['mod origin;', 'pub(crate) mod pairing;']) {
    assert(source.includes(`#[cfg(any(windows, test))]\n${declaration}`),
      `${declaration} must retain Windows implementation and real host tests`);
  }
  for (const name of ['account', 'discovery', 'internet']) {
    const declaration = new RegExp(String.raw`(?:pub\(crate\) )?mod ${name};`);
    assert.match(source, declaration);
    const at = source.search(declaration);
    const preceding = source.slice(0, at).trimEnd();
    assert(!/#\[cfg\([^\n]+\)\]$/.test(preceding), `${name} must remain portable`);
  }
  assert.match(source, /pub\(crate\) use tempo_client::ComputerKey;/);
  assert.match(source, /pub\(crate\) use tempo_client::(?:audio_road|link|stop_road);/);
  for (const name of ['code', 'list', 'drop_signed', 'list_away', 'forget']) {
    assert(source.includes(`#[cfg(any(windows, test))]\n` +
      `    pub(crate) fn ${name}(`) || source.includes(
      `#[cfg(any(windows, test))]\npub(crate) fn ${name}(`), `${name} keeps host tests`);
  }
}

test('Windows LAN window helpers retain tests without gating portable account roads', () => {
  const source = read('lan_client.rs');
  lanWindowBoundary(source);
  assert.throws(() => lanWindowBoundary(source.replace(
    '#[cfg(any(windows, test))]\nmod origin;', '#[cfg(windows)]\nmod origin;')));
  assert.throws(() => lanWindowBoundary(source.replace(
    'pub(crate) mod account;', '#[cfg(windows)]\npub(crate) mod account;')));
  assert.throws(() => lanWindowBoundary(source.replace(
    '#[cfg(any(windows, test))]\n    pub(crate) fn forget(', '    pub(crate) fn forget(')));
});

function portableDiscovery(account, origin, discovery) {
  assert.match(account, /use super::discovery::\{Find, FIND_FOR\};/);
  assert.doesNotMatch(account, /use super::origin::/);
  assert.match(origin, /pub\(crate\) use super::discovery::\{Find, FIND_FOR\};/);
  assert.match(discovery, /const FIND_FOR: Duration = Duration::from_secs\(3\);/);
  assert.match(discovery, /type Find = Arc<dyn Fn\(Duration\) -> Result<Vec<Found>, Unavailable> \+ Send \+ Sync>;/);
  assert.doesNotMatch(discovery, /#\[cfg\(/);
}

test('portable account discovery shares the unchanged callback and timeout outside Windows origin', () => {
  const account = read('lan_client/account.rs');
  const origin = read('lan_client/origin.rs');
  const discovery = read('lan_client/discovery.rs');
  portableDiscovery(account, origin, discovery);
  assert.throws(() => portableDiscovery(account.replace('super::discovery::', 'super::origin::'), origin, discovery));
  assert.throws(() => portableDiscovery(account, origin, discovery.replace('from_secs(3)', 'from_secs(30)')));
});

function androidWindowControls(source) {
  for (const [name, end, reason, operation] of [
    ['set_window_behind', '/// The record with stay-behind', 'staying behind other windows is not available on Android', 'set_always_on_bottom'],
    ['set_window_on_top', '/// Bring the calling window', 'pinning above other applications is not available on Android', 'set_always_on_top'],
  ]) {
    const start = source.indexOf(`pub fn ${name}(`);
    const stop = source.indexOf(end, start);
    assert(start >= 0 && stop > start);
    const command = source.slice(start, stop);
    const android = command.indexOf('#[cfg(target_os = "android")]');
    const desktop = command.indexOf('#[cfg(not(target_os = "android"))]');
    assert(android >= 0 && desktop > android, 'Unsupported OS operations need a compile-time boundary');
    const mobile = command.slice(android, desktop);
    assert(mobile.includes(`Err("${reason}".into())`));
    assert.doesNotMatch(mobile, /save_panel|set_always_on|Ok\(/);
    assert(command.indexOf('save_panel') > desktop, 'Never persist a refused mobile OS operation');
    assert(command.indexOf(operation) > desktop, 'Desktop operations must remain implemented');
  }
  assert.match(source, /cfg!\(not\(target_os = "android"\)\) && slug == crate::CONTEST_LOGGER_SLUG/);
  const start = source.indexOf('pub async fn focus_window(');
  const stop = source.indexOf('\n#[cfg(test)]\nmod tests', start);
  assert(start >= 0 && stop > start);
  const focus = source.slice(start, stop);
  const android = focus.indexOf('#[cfg(target_os = "android")]');
  assert(android > focus.indexOf('window.unminimize()'), 'Desktop restore stays outside Android');
  const mobile = focus.slice(android);
  assert.match(mobile, /\.with_webview\([\s\S]*?\.jni_handle\(\)\.exec\(/);
  assert.match(mobile, /"setVisibility", "\(I\)V", &\[JValue::Int\(0\)\]/);
  assert.match(mobile, /"requestFocus", "\(\)Z"/);
  assert.match(mobile, /if focused \{\s*Ok\(\(\)\)\s*\} else \{\s*Err\("Android WebView did not accept focus"/);
  assert.match(mobile, /exception_clear\(\)/);
  assert(mobile.indexOf('tx.is_closed()') < mobile.indexOf('"setVisibility"') && mobile.includes('tx.is_closed()'),
    'A cancelled focus request must not change the WebView later');
  assert.match(mobile, /tokio::time::timeout\([\s\S]*?rx\)[\s\S]*?\.await/);
  assert.doesNotMatch(mobile, /\.unminimize\(|\.set_always_on|moveTaskToFront/);
}

test('Android OS window controls refuse before persistence and focus the actual WebView', () => {
  const source = read('window_state.rs');
  androidWindowControls(source);
  assert.throws(() => androidWindowControls(source.replace(
    'Err("pinning above other applications is not available on Android".into())', 'Ok(WindowOnTop { supported: true, on })')));
  const start = source.indexOf('pub fn set_window_behind(');
  assert.throws(() => androidWindowControls(source.slice(0, start) + source.slice(start).replace(
    '#[cfg(not(target_os = "android"))]', 'if cfg!(not(target_os = "android"))')));
  assert.throws(() => androidWindowControls(source.replace('"requestFocus", "()Z"', '"fakeFocus", "()Z"')));
});

function androidShapeBoundary(source, adapter) {
  assert.match(source, /#\[cfg\(not\(target_os = "android"\)\)\]\s*impl crate::remote_service::stream::ShapeWindow for MainShape/);
  const start = source.indexOf('#[cfg(target_os = "android")]\nimpl crate::remote_service::stream::ShapeWindow for MainShape');
  const end = source.indexOf('// ---- The Connect dashboard pop-out', start);
  assert(start >= 0 && end > start);
  const shape = source.slice(start, end);
  assert.match(shape, /android_shape::follow\(&window, view\)/);
  assert.match(shape, /android_shape::restore\(&window\)/);
  assert.match(adapter, /\.jni_handle\(\)\.exec\(/);
  assert.match(adapter, /"nexusFollowWindowShape",\s*"\(Landroid\/webkit\/WebView;II\)Z"/);
  assert.match(adapter, /"nexusRestoreWindowShape",\s*"\(Landroid\/webkit\/WebView;\)V"/);
  assert.match(adapter, /i32::try_from\(view\.0\)/);
  assert.match(adapter, /if accepted \{\s*Ok\(\(\)\)\s*\} else \{\s*Err\(/);
  assert.match(adapter, /exception_clear\(\)/);
  assert.doesNotMatch(shape + adapter, /\.maximize\(|\.minimize\(|\.set_fullscreen\(|\.set_position\(/);
}

test('Android MainShape delegates both lifecycle directions to the actual Java WebView adapter', () => {
  const source = read('window_state.rs');
  const adapter = read('window_state/android_shape.rs');
  androidShapeBoundary(source, adapter);
  assert.throws(() => androidShapeBoundary(source.replace('android_shape::follow(&window, view)', 'ignore_view(view)'), adapter));
  assert.throws(() => androidShapeBoundary(source.replaceAll('android_shape::restore(&window)', 'ignore_restore(&window)'), adapter));
  assert.throws(() => androidShapeBoundary(source, adapter.replace('"nexusFollowWindowShape"', '"fakeShape"')));
});
