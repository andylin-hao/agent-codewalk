use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Agent implementations supported by the portable integration.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentKind {
    Codex,
    ClaudeCode,
    Opencode,
    #[default]
    Other,
}

/// Arguments accepted by the `begin_task` MCP tool.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct BeginTaskRequest {
    pub goal: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub agent: AgentKind,
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginTaskResult {
    pub task_id: String,
    pub workspace_root: String,
    pub started_at: String,
    pub degraded_baseline: bool,
    pub warnings: Vec<String>,
}

/// A code range and explanation supplied by the modifying agent.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StepInput {
    pub id: String,
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub title: String,
    pub explanation: String,
    #[serde(default)]
    pub flow_after: Vec<String>,
    #[serde(default)]
    pub symbol: Option<String>,
}

/// Arguments accepted by the `publish_walkthrough` MCP tool.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct PublishWalkthroughRequest {
    #[serde(default)]
    pub task_id: Option<String>,
    pub title: String,
    pub summary: String,
    pub steps: Vec<StepInput>,
    #[serde(default)]
    pub goal: Option<String>,
    #[serde(default)]
    pub agent: AgentKind,
    #[serde(default)]
    pub session_id: Option<String>,
}

/// Arguments accepted by the `publish_explanation` MCP tool.
///
/// An explanation has no baseline and no diff, so it needs neither a task nor coverage
/// validation. Only the steps and the question they answer are supplied.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct PublishExplanationRequest {
    pub title: String,
    pub summary: String,
    pub topic: String,
    pub steps: Vec<StepInput>,
    #[serde(default)]
    pub agent: AgentKind,
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishWalkthroughResult {
    pub walkthrough_id: String,
    pub session_path: String,
    pub step_count: usize,
    pub changed_hunk_count: usize,
    pub excluded_changes: Vec<ExcludedChange>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct TaskIdRequest {
    pub task_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatusResult {
    pub task_id: String,
    pub exists: bool,
    pub workspace_root: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BaselineManifest {
    pub id: String,
    pub workspace_root: String,
    pub git_root: Option<String>,
    pub head: Option<String>,
    pub goal: String,
    pub title: Option<String>,
    pub agent: AgentKind,
    pub session_id: Option<String>,
    pub started_at: String,
    pub degraded_baseline: bool,
    pub snapshots: BTreeMap<String, String>,
    pub baseline_absent: Vec<String>,
    pub excluded_snapshots: Vec<ExcludedChange>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct Walkthrough {
    pub schema_version: u32,
    pub kind: WalkthroughKind,
    pub id: String,
    pub workspace_fingerprint: String,
    pub title: String,
    pub summary: String,
    pub agent: WalkthroughAgent,
    pub task: WalkthroughTask,
    pub created_at: String,
    pub steps: Vec<WalkthroughStep>,
    pub file_order: Vec<String>,
    pub flow_order: Vec<String>,
    pub changed_hunks: Vec<ChangeHunk>,
    /// Hunks that no step explains. Only a degraded baseline may publish a
    /// non-empty list; a complete baseline rejects publication instead.
    pub uncovered_hunks: Vec<ChangeHunk>,
    pub excluded_changes: Vec<ExcludedChange>,
    pub degraded_baseline: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct WalkthroughAgent {
    pub kind: AgentKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct WalkthroughTask {
    pub id: String,
    pub goal: String,
    pub started_at: String,
    pub completed_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct WalkthroughStep {
    pub id: String,
    pub path: String,
    pub title: String,
    pub explanation: String,
    pub change_kind: ChangeKind,
    pub anchor: CodeAnchor,
    pub flow_after: Vec<String>,
    pub target_available: bool,
    /// The baseline text this step replaced, present when a diff can be shown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_text: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct CodeAnchor {
    pub start_line: u32,
    pub end_line: u32,
    pub line_count: u32,
    pub normalized_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
}

/// What a walkthrough explains.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WalkthroughKind {
    /// Explains what a task modified, validated against the recorded baseline.
    #[default]
    Change,
    /// A tour of code that was not modified, published for an analysis request.
    Explanation,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Add,
    Modify,
    Delete,
    Rename,
    /// The block did not change; it is shown because the walkthrough needs it.
    Context,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ChangeHunk {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub kind: ChangeKind,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ExcludedChange {
    pub path: String,
    pub reason: String,
}

/// A changed hunk together with the text it replaced, kept only in memory so that
/// steps can carry a small "before" excerpt without storing whole source files.
#[derive(Clone, Debug)]
pub(crate) struct HunkDetail {
    pub hunk: ChangeHunk,
    pub previous_text: String,
}

#[derive(Debug)]
pub(crate) struct DiffResult {
    pub details: Vec<HunkDetail>,
    pub excluded: Vec<ExcludedChange>,
}

impl DiffResult {
    /// Returns the published hunks without their baseline text.
    pub(crate) fn hunks(&self) -> Vec<ChangeHunk> {
        self.details
            .iter()
            .map(|detail| detail.hunk.clone())
            .collect()
    }
}
