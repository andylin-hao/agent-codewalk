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
pub struct Walkthrough {
    pub schema_version: u32,
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
    pub excluded_changes: Vec<ExcludedChange>,
    pub degraded_baseline: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkthroughAgent {
    pub kind: AgentKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkthroughTask {
    pub id: String,
    pub goal: String,
    pub started_at: String,
    pub completed_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkthroughStep {
    pub id: String,
    pub path: String,
    pub title: String,
    pub explanation: String,
    pub change_kind: ChangeKind,
    pub anchor: CodeAnchor,
    pub flow_after: Vec<String>,
    pub target_available: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeAnchor {
    pub start_line: u32,
    pub end_line: u32,
    pub line_count: u32,
    pub normalized_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Add,
    Modify,
    Delete,
    Rename,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangeHunk {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub kind: ChangeKind,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedChange {
    pub path: String,
    pub reason: String,
}

#[derive(Debug)]
pub(crate) struct DiffResult {
    pub hunks: Vec<ChangeHunk>,
    pub excluded: Vec<ExcludedChange>,
}
