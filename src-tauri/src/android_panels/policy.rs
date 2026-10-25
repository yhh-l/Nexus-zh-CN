//! Trusted in-app Android panel components. No incoming URL or Java class name is accepted.
//! Each panel has its own component so Android's REORDER_TO_FRONT selects that exact existing
//! page rather than a different panel of the same Activity class. Existing chain admission and
//! stable panel labels remain the authority; this table grants no station/RF permissions.
pub(crate) const ACTIVITIES: &[(&str, &str)] = &[
    ("waterfall", "WaterfallPanelActivity"),
    ("needed", "NeededPanelActivity"),
    ("spots", "SpotsPanelActivity"),
    ("memories", "MemoriesPanelActivity"),
    ("connect", "ConnectPanelActivity"),
    ("dxped", "DxpedPanelActivity"),
    ("pota", "PotaPanelActivity"),
    ("sstvviewer", "SstvviewerPanelActivity"),
    ("sats", "SatsPanelActivity"),
    ("fieldday", "FielddayPanelActivity"),
    ("contestlog", "ContestlogPanelActivity"),
    ("contestscreen", "ContestscreenPanelActivity"),
    ("fdclub", "FdclubPanelActivity"),
    ("operate", "OperatePanelActivity"),
    ("operatemap", "OperatemapPanelActivity"),
    ("bandmapPhone", "BandmapPhonePanelActivity"),
    ("bandmapCw", "BandmapCwPanelActivity"),
];

pub(crate) fn activity(panel: &str) -> Option<String> {
    ACTIVITIES
        .iter()
        .find(|(slug, _)| *slug == panel)
        .map(|(_, class)| format!("com.kd9taw.tempo.{class}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_panel_component_is_unique_and_app_owned() {
        let mut components = std::collections::BTreeSet::new();
        let mut slugs = std::collections::BTreeSet::new();
        for (slug, class) in ACTIVITIES {
            assert!(slugs.insert(slug));
            assert!(components.insert(class));
            assert_eq!(activity(slug), Some(format!("com.kd9taw.tempo.{class}")));
        }
    }
    #[test]
    fn unknown_or_url_shaped_inputs_cannot_become_components() {
        for bad in [
            "",
            "MainActivity",
            "https://example.invalid",
            "needed&instance=r1",
            "needed/../settings",
            "NEEDED",
        ] {
            assert_eq!(activity(bad), None);
        }
    }
}
