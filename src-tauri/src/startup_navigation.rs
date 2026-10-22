//! Wait for Tauri's configured waiting page before deriving the main app address.
//! WebView2 can report about:blank while its first navigation is still pending.
//! Called only after the logbook has attached; this grants no earlier UI or TX access.

use tauri::Url;

/// The root beside the configured waiting page is Tauri's app address, both in a
/// bundled build and under the development server. Never invent an origin for about:blank.
pub(crate) fn app_address(waiting: &Url) -> Option<Url> {
    waiting.join("./").ok()
}

/// Retry only the transient initial about:blank. The caller bounds and paces the wait
/// on the launch thread; URL errors and unrelated invalid addresses still fail loudly.
pub(crate) fn wait_for_app_address(
    mut read: impl FnMut() -> Result<Url, String>,
    mut wait: impl FnMut() -> bool,
) -> Result<Url, String> {
    loop {
        let waiting = read()?;
        if let Some(app) = app_address(&waiting) {
            return Ok(app);
        }
        if waiting.as_str() != "about:blank" || !wait() {
            return Err(format!("no app address beside {waiting}"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_blank_then_configured_waiting_page_reaches_the_app() {
        for (waiting, expected) in [
            ("http://tauri.localhost/blank.html", "http://tauri.localhost/"),
            ("tauri://localhost/blank.html", "tauri://localhost/"),
            ("http://localhost:5173/blank.html", "http://localhost:5173/"),
        ] {
            let mut pages = ["about:blank", "about:blank", waiting].into_iter();
            let mut waits = 0;
            let app = wait_for_app_address(
                || Ok(Url::parse(pages.next().expect("must stop once ready")).unwrap()),
                || {
                    waits += 1;
                    true
                },
            )
            .unwrap();
            assert_eq!(app.as_str(), expected);
            assert_eq!(waits, 2);
        }
    }

    #[test]
    fn an_initial_page_that_never_navigates_exhausts_the_bound() {
        let mut waits = 0;
        let error = wait_for_app_address(
            || Ok(Url::parse("about:blank").unwrap()),
            || {
                waits += 1;
                waits < 3
            },
        )
        .unwrap_err();
        assert_eq!(waits, 3);
        assert_eq!(error, "no app address beside about:blank");
    }

    #[test]
    fn a_ready_page_needs_no_wait_and_a_read_error_is_not_retried() {
        let app = wait_for_app_address(
            || Ok(Url::parse("http://tauri.localhost/blank.html").unwrap()),
            || panic!("a ready page must not wait"),
        )
        .unwrap();
        assert_eq!(app.as_str(), "http://tauri.localhost/");
        assert_eq!(
            wait_for_app_address(|| Err("window gone".into()), || panic!("read failed")),
            Err("window gone".into())
        );
    }

    #[test]
    fn another_opaque_address_fails_without_retrying() {
        assert!(wait_for_app_address(
            || Ok(Url::parse("data:text/plain,not-the-app").unwrap()),
            || panic!("only initial about:blank is transient"),
        )
        .is_err());
    }
}
