//! Client-mode station-isolation source guards, shared by the full shell tests
//! and focused cloud Rust tests. No application code or station is executed.

/// Everything of the crate's own this module may reach, each read here to start nothing of a
/// station: the dispatcher's tables and the link; this computer's own files; the windows and
/// their layouts; the app's command list and context; and the state the "runs here" commands read.
const MAY_REACH: &[&str] = &[
    "crate::command_classes",
    "crate::command_dispatch",
    "crate::lan_client::link",
    // The road's order of addresses, and what a look by name may try: it reads a record and an
    // advert, and starts nothing.
    "crate::lan_client::road",
    "crate::lan_client::stop_road",
    // This computer's headset for the shack's audio: its own output and microphone, opened only
    // while wanted. It plays and captures, and starts nothing of a station.
    "crate::lan_client::audio_road",
    "crate::lan_client::Stations",
    // Where the typed file is: a path beside the default profile's settings. It opens nothing.
    "crate::lan_client::typed_path",
    // Where the sign-in times are, beside it; and this computer's name. They open nothing.
    "crate::lan_client::signed_path",
    "crate::lan_client::computer_name",
    // Signing in again for the station this launch drives: the system browser, this computer's
    // own requests to the Remote service and its issuer, and its enrolment on a connection of
    // its own to the station, which keeps it. It keys nothing and starts nothing of a station.
    "crate::lan_client::account",
    // The internet road: this computer's own requests to the Remote service (a pipe, its relay, a
    // renewal) and the road's record in this computer's store. It opens a link and starts nothing
    // of a station.
    "crate::lan_client::internet",
    // A test build's road switch: this computer's own roads to the shack, blocked one at a time.
    // It opens and starts nothing.
    "crate::bench_road_switch",
    // WebView2's browser keys off in each window as Tauri makes it: one setting of the webview's
    // own, and nothing else.
    "crate::browser_keys::init",
    "crate::remote_service::vault::PairedStation",
    "crate::remote_service::vault::SystemVault",
    "crate::ui_state_read",
    "crate::ui_state_path",
    "crate::settings_path",
    "crate::write_json_atomic",
    "crate::active_profile",
    "crate::send_main_window_to_the_app",
    "crate::app_commands",
    "crate::context",
    "crate::BetaUpdateState",
    "crate::street_map::StreetMapState",
    "crate::remote_window::LanOrigin",
    "crate::RESOURCE_DIR",
    "crate::DISPLAY_DPI",
    "crate::probe_physical_dpi",
    "crate::DOCUMENTS_DIR",
    "crate::PICTURES_DIR",
    "crate::window_state::install",
    // Reviewed OS-login adapter only: plugin registration and the same OS preference,
    // not station startup. Its actual implementation is checked below, including mutants.
    "crate::login_start::install",
    "crate::login_start::set",
    "crate::capture_all_window_geometry",
    "crate::capture_bandmap_window",
    "crate::show_startup_failure",
];

/// What starts a station, or holds one: none of it may be named in client mode.
const A_STATION: &[&str] = &[
    "SharedEngine",
    "engine_lock",
    "Engine::",
    "launch_engine",
    "start_on_the_logbook",
    "finish_launch",
    "remote_service_for",
    "build_app",
    "quit_cleanup",
    "tempo_audio",
    "start_cluster_feeds",
    "start_pskr_feed",
    "start_wspr_feed",
    "start_pskr_region_feed",
    "fdsync",
    "fd_scoreboard",
    "connect_web",
    "rigctld",
    "pouncer",
    "Settings::load",
    "logbook",
];

/// The module's code: its source with every comment taken out, so its prose (which says what it
/// never opens) is not read as code. Its tests are in this file, not in it.
pub(crate) fn client_source() -> String {
    include_str!("../client_mode.rs")
        .lines()
        .map(|line| line.split("//").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n")
}

/// ★ No station here, by construction: client mode names nothing that starts or holds a station
/// (no Engine, no logbook, no radio or daemon, no feed, listener or uploader), and of the crate's
/// own it reaches only what [`MAY_REACH`] lists, each of which starts none. The app it builds
/// manages client mode's state and the state of this computer's own commands, and no Engine.
/// CONTROL: the scan finds the module's own calls, and names it was planted with.
#[test]
fn client_mode_reaches_nothing_of_a_station() {
    let source = client_source();
    let source = source.as_str();
    for name in A_STATION {
        assert!(!source.contains(name), "client mode names `{name}`");
    }
    let mut reached: Vec<&str> = Vec::new();
    let mut rest = source;
    while let Some(at) = rest.find("crate::") {
        let path: &str = &rest[at..];
        let end = path
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == ':'))
            .unwrap_or(path.len());
        reached.push(path[..end].trim_end_matches(':'));
        rest = &rest[at + end..];
    }
    assert!(
        reached.contains(&"crate::app_commands"),
        "the scan reads the calls: {reached:?}"
    );
    for path in &reached {
        assert!(
            MAY_REACH.iter().any(|allowed| path.starts_with(allowed)),
            "client mode reaches `{path}`: read it, and list it in MAY_REACH if it starts nothing"
        );
    }
    let run = &source[source
        .find("pub(crate) fn run(station: String)")
        .expect("run")..];
    let managed: Vec<&str> = run
        .match_indices(".manage(")
        .map(|(at, _)| {
            let inner = &run[at + ".manage(".len()..];
            &inner[..inner.find(")\n").expect("one line")]
        })
        .collect();
    assert_eq!(
        managed,
        [
            "Arc::clone(&client)",
            "crate::BetaUpdateState::default()",
            "crate::street_map::StreetMapState::default()",
            "crate::remote_window::LanOrigin::default()",
        ]
    );
    // The scan is not blind: a planted name is found.
    let planted = format!("{source}\n    crate::start_cluster_feeds(&spots);");
    assert!(planted.contains("start_cluster_feeds"));
}

/// Scan the actual adapter as well as its callers: admitting a wrapper must not admit
/// a hidden station startup behind it. This guard is source evidence, not RF proof.
fn assert_login_adapter_starts_nothing(raw: &str) {
    let source = raw
        .lines()
        .map(|line| line.split("//").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n");
    for token in A_STATION.iter().copied().chain([
        "crate::",
        "std::thread::spawn",
        "std::process::Command",
        "Command::new",
    ]) {
        assert!(!source.contains(token), "OS-login adapter reaches `{token}`");
    }
}

#[test]
fn the_reviewed_login_adapter_starts_no_station_and_its_guard_detects_a_hidden_start() {
    let source = include_str!("../login_start.rs");
    assert_login_adapter_starts_nothing(source);
    for planted in [
        "crate::start_cluster_feeds(&spots);",
        "crate::run();",
        "tempo_audio::service::run_radio();",
        "std::process::Command::new(\"station\");",
    ] {
        let mutant = format!("{source}\n{planted}");
        assert!(std::panic::catch_unwind(|| assert_login_adapter_starts_nothing(&mutant)).is_err());
    }
}
