use std::path::Path;

use serde::{Deserialize, Serialize};

const TRIGGER_ENVIRONMENT_VARIABLE: &str = "AGENT_CODEWALK_TRIGGER";
const SETTINGS_FILE: &str = "settings.json";

/// When an agent should produce a walkthrough.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Trigger {
    /// Record a baseline before the first edit and publish once the work is verified.
    #[default]
    Auto,
    /// Publish only when the user asks for a walkthrough.
    Manual,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct Settings {
    trigger: Trigger,
}

/// Reads the configured trigger, defaulting to automatic.
///
/// The editor writes this file, but the companion is started by the agent rather than by
/// the editor, so the value is read from disk on each use instead of being passed in.
/// The prompt reminder and the stop hook are separate processes and therefore see a
/// change immediately; server instructions are sent once per agent session and see it on
/// the next one. Anything unreadable or unrecognized falls back to automatic, because
/// silently publishing nothing is the worse failure.
///
/// @param root The companion's data directory.
#[must_use]
pub fn trigger(root: &Path) -> Trigger {
    if let Some(value) = std::env::var_os(TRIGGER_ENVIRONMENT_VARIABLE) {
        return match value.to_string_lossy().trim().to_ascii_lowercase().as_str() {
            "manual" => Trigger::Manual,
            _ => Trigger::Auto,
        };
    }
    std::fs::read(root.join(SETTINGS_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok())
        .unwrap_or_default()
        .trigger
}

#[cfg(test)]
mod tests {
    use super::{Trigger, trigger};
    use tempfile::tempdir;

    #[test]
    fn defaults_to_automatic_without_a_settings_file() {
        assert_eq!(trigger(tempdir().unwrap().path()), Trigger::Auto);
    }

    #[test]
    fn reads_the_configured_trigger() {
        let root = tempdir().unwrap();
        std::fs::write(root.path().join("settings.json"), r#"{"trigger":"manual"}"#).unwrap();
        assert_eq!(trigger(root.path()), Trigger::Manual);
    }

    #[test]
    fn falls_back_to_automatic_on_unreadable_settings() {
        // Publishing nothing is a worse failure than publishing when not asked, so a
        // corrupt file must not silently disable walkthroughs.
        let root = tempdir().unwrap();
        std::fs::write(root.path().join("settings.json"), "{ not json").unwrap();
        assert_eq!(trigger(root.path()), Trigger::Auto);
    }

    #[test]
    fn ignores_an_unrecognized_trigger() {
        let root = tempdir().unwrap();
        std::fs::write(root.path().join("settings.json"), r#"{"trigger":"later"}"#).unwrap();
        assert_eq!(trigger(root.path()), Trigger::Auto);
    }
}
