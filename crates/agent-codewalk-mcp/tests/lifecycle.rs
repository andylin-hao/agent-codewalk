use std::{fs, path::Path, process::Command};

use agent_codewalk_mcp::{
    CodeWalkService,
    model::{
        AgentKind, BeginTaskRequest, ChangeKind, PublishExplanationRequest,
        PublishWalkthroughRequest, StepInput, Walkthrough, WalkthroughKind,
    },
    storage::Storage,
};
use tempfile::tempdir;

#[test]
fn shared_v1_fixture_matches_the_rust_contract() {
    let fixture = include_str!("../../../protocol/fixtures/valid-minimal.json");
    let walkthrough: Walkthrough = serde_json::from_str(fixture).unwrap();
    assert_eq!(walkthrough.schema_version, 1);
    assert_eq!(walkthrough.file_order, vec!["ready"]);
}

#[test]
fn pending_task_count_drives_stop_hook_reminders() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    initialize_repository(workspace.path());
    let service = CodeWalkService::new(
        workspace.path(),
        Storage::new(state.path().to_owned()).unwrap(),
    )
    .unwrap();
    let task = service
        .begin_task(BeginTaskRequest {
            goal: "Change code".to_owned(),
            title: None,
            agent: AgentKind::Other,
            session_id: None,
        })
        .unwrap();
    assert_eq!(service.pending_task_count().unwrap(), 1);
    service.abort_task(&task.task_id).unwrap();
    assert_eq!(service.pending_task_count().unwrap(), 0);
}

#[test]
fn publishes_only_changes_made_after_the_task_baseline() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    initialize_repository(workspace.path());

    let source = workspace.path().join("src/lib.rs");
    fs::write(&source, "pub fn value() -> i32 {\n    2\n}\n").unwrap();
    let service = CodeWalkService::new(
        workspace.path(),
        Storage::new(state.path().to_owned()).unwrap(),
    )
    .unwrap();
    let task = service
        .begin_task(BeginTaskRequest {
            goal: "Add a readiness helper".to_owned(),
            title: None,
            agent: AgentKind::Codex,
            session_id: Some("session-1".to_owned()),
        })
        .unwrap();

    fs::write(
        &source,
        "pub fn value() -> i32 {\n    2\n}\n\npub fn ready() -> bool {\n    true\n}\n",
    )
    .unwrap();
    let result = service
        .publish_walkthrough(PublishWalkthroughRequest {
            task_id: Some(task.task_id),
            title: "Add readiness helper".to_owned(),
            summary: "Callers can now query readiness directly.".to_owned(),
            steps: vec![StepInput {
                id: "ready".to_owned(),
                path: "src/lib.rs".to_owned(),
                start_line: 5,
                end_line: 7,
                title: "Expose readiness".to_owned(),
                explanation: "The new helper returns the component readiness state.".to_owned(),
                flow_after: Vec::new(),
                symbol: Some("ready".to_owned()),
            }],
            goal: None,
            agent: AgentKind::Other,
            session_id: None,
        })
        .unwrap();

    assert_eq!(result.changed_hunk_count, 1);
    let walkthrough: Walkthrough =
        serde_json::from_slice(&fs::read(result.session_path).unwrap()).unwrap();
    assert_eq!(walkthrough.changed_hunks[0].start_line, 4);
    assert_eq!(walkthrough.steps[0].anchor.start_line, 5);
    assert!(!walkthrough.degraded_baseline);
}

#[test]
fn keeps_the_task_when_publication_has_uncovered_hunks() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    initialize_repository(workspace.path());
    let service = CodeWalkService::new(
        workspace.path(),
        Storage::new(state.path().to_owned()).unwrap(),
    )
    .unwrap();
    let task = service
        .begin_task(BeginTaskRequest {
            goal: "Change a value".to_owned(),
            title: None,
            agent: AgentKind::Other,
            session_id: None,
        })
        .unwrap();
    fs::write(
        workspace.path().join("src/lib.rs"),
        "pub fn value() -> i32 {\n    3\n}\n",
    )
    .unwrap();

    let error = service
        .publish_walkthrough(PublishWalkthroughRequest {
            task_id: Some(task.task_id.clone()),
            title: "Change".to_owned(),
            summary: "Change summary".to_owned(),
            steps: vec![StepInput {
                id: "wrong".to_owned(),
                path: "src/lib.rs".to_owned(),
                start_line: 1,
                end_line: 1,
                title: "Wrong range".to_owned(),
                explanation: "This does not cover line two.".to_owned(),
                flow_after: Vec::new(),
                symbol: None,
            }],
            goal: None,
            agent: AgentKind::Other,
            session_id: None,
        })
        .unwrap_err();
    assert!(error.to_string().contains("src/lib.rs:2-2"));
    assert!(service.get_status(&task.task_id).unwrap().exists);
}

#[test]
fn publishes_a_visibly_degraded_session_when_begin_task_was_missed() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    initialize_repository(workspace.path());
    fs::write(
        workspace.path().join("src/lib.rs"),
        "pub fn value() -> i32 {\n    9\n}\n",
    )
    .unwrap();
    let service = CodeWalkService::new(
        workspace.path(),
        Storage::new(state.path().to_owned()).unwrap(),
    )
    .unwrap();

    let result = service
        .publish_walkthrough(PublishWalkthroughRequest {
            task_id: None,
            title: "Change value".to_owned(),
            summary: "The value now reflects the new default.".to_owned(),
            steps: vec![StepInput {
                id: "value".to_owned(),
                path: "src/lib.rs".to_owned(),
                start_line: 1,
                end_line: 3,
                title: "Update the default".to_owned(),
                explanation: "The helper now returns the requested default.".to_owned(),
                flow_after: Vec::new(),
                symbol: Some("value".to_owned()),
            }],
            goal: Some("Update the default value".to_owned()),
            agent: AgentKind::ClaudeCode,
            session_id: Some("missed-baseline".to_owned()),
        })
        .unwrap();

    assert!(
        result
            .warnings
            .iter()
            .any(|warning| warning.contains("without a complete Git baseline"))
    );
    let walkthrough: Walkthrough =
        serde_json::from_slice(&fs::read(result.session_path).unwrap()).unwrap();
    assert!(walkthrough.degraded_baseline);
    assert_eq!(walkthrough.task.goal, "Update the default value");
    assert_eq!(walkthrough.changed_hunks.len(), 1);
}

#[test]
fn lists_generated_changes_without_requiring_a_highlight_step() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    initialize_repository(workspace.path());
    let service = CodeWalkService::new(
        workspace.path(),
        Storage::new(state.path().to_owned()).unwrap(),
    )
    .unwrap();
    let task = service
        .begin_task(BeginTaskRequest {
            goal: "Update code and its lockfile".to_owned(),
            title: None,
            agent: AgentKind::Codex,
            session_id: None,
        })
        .unwrap();
    fs::write(
        workspace.path().join("src/lib.rs"),
        "pub fn value() -> i32 {\n    4\n}\n",
    )
    .unwrap();
    fs::write(
        workspace.path().join("Cargo.lock"),
        "generated dependency state\n",
    )
    .unwrap();

    let result = service
        .publish_walkthrough(PublishWalkthroughRequest {
            task_id: Some(task.task_id),
            title: "Update code and lockfile".to_owned(),
            summary: "The code changed and generated dependency state was refreshed.".to_owned(),
            steps: vec![StepInput {
                id: "value".to_owned(),
                path: "src/lib.rs".to_owned(),
                start_line: 1,
                end_line: 3,
                title: "Update the value".to_owned(),
                explanation: "The helper now returns the new value.".to_owned(),
                flow_after: Vec::new(),
                symbol: Some("value".to_owned()),
            }],
            goal: None,
            agent: AgentKind::Other,
            session_id: None,
        })
        .unwrap();

    assert_eq!(result.excluded_changes.len(), 1);
    assert_eq!(result.excluded_changes[0].path, "Cargo.lock");
    assert!(result.excluded_changes[0].reason.contains("generated"));
}

#[test]
fn records_uncovered_hunks_instead_of_failing_on_a_degraded_baseline() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    initialize_repository(workspace.path());
    fs::write(
        workspace.path().join("src/lib.rs"),
        "pub fn value() -> i32 {\n    9\n}\n",
    )
    .unwrap();
    fs::write(workspace.path().join("src/extra.rs"), "pub fn extra() {}\n").unwrap();
    let service = CodeWalkService::new(
        workspace.path(),
        Storage::new(state.path().to_owned()).unwrap(),
    )
    .unwrap();

    let result = service
        .publish_walkthrough(PublishWalkthroughRequest {
            task_id: None,
            title: "Change value".to_owned(),
            summary: "The value changed but a second file was not explained.".to_owned(),
            steps: vec![StepInput {
                id: "value".to_owned(),
                path: "src/lib.rs".to_owned(),
                start_line: 1,
                end_line: 3,
                title: "Update the default".to_owned(),
                explanation: "The helper returns the requested default.".to_owned(),
                flow_after: Vec::new(),
                symbol: None,
            }],
            goal: Some("Update the default value".to_owned()),
            agent: AgentKind::Opencode,
            session_id: None,
        })
        .unwrap();

    assert!(
        result
            .warnings
            .iter()
            .any(|warning| warning.contains("src/extra.rs")),
        "the reader must be told which change has no explanation: {:?}",
        result.warnings
    );
    let walkthrough: Walkthrough =
        serde_json::from_slice(&fs::read(result.session_path).unwrap()).unwrap();
    assert!(walkthrough.degraded_baseline);
    assert_eq!(walkthrough.uncovered_hunks.len(), 1);
    assert_eq!(walkthrough.uncovered_hunks[0].path, "src/extra.rs");
}

#[test]
fn records_the_replaced_text_so_a_step_can_show_a_diff() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    initialize_repository(workspace.path());
    let service = CodeWalkService::new(
        workspace.path(),
        Storage::new(state.path().to_owned()).unwrap(),
    )
    .unwrap();
    let task = service
        .begin_task(BeginTaskRequest {
            goal: "Change the default value".to_owned(),
            title: None,
            agent: AgentKind::Codex,
            session_id: None,
        })
        .unwrap();
    fs::write(
        workspace.path().join("src/lib.rs"),
        "pub fn value() -> i32 {\n    7\n}\n",
    )
    .unwrap();

    let result = service
        .publish_walkthrough(PublishWalkthroughRequest {
            task_id: Some(task.task_id),
            title: "Change the default".to_owned(),
            summary: "The helper returns a new default.".to_owned(),
            steps: vec![StepInput {
                id: "value".to_owned(),
                path: "src/lib.rs".to_owned(),
                start_line: 2,
                end_line: 2,
                title: "Return the new default".to_owned(),
                explanation: "Callers now observe the updated default.".to_owned(),
                flow_after: Vec::new(),
                symbol: None,
            }],
            goal: None,
            agent: AgentKind::Codex,
            session_id: None,
        })
        .unwrap();

    let walkthrough: Walkthrough =
        serde_json::from_slice(&fs::read(result.session_path).unwrap()).unwrap();
    assert_eq!(
        walkthrough.steps[0].previous_text.as_deref(),
        Some("    1"),
        "the step must carry the line it replaced"
    );
    assert!(walkthrough.uncovered_hunks.is_empty());
}

#[test]
fn publishes_an_explanation_of_unchanged_code() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    initialize_repository(workspace.path());
    let service = CodeWalkService::new(
        workspace.path(),
        Storage::new(state.path().to_owned()).unwrap(),
    )
    .unwrap();

    let result = service
        .publish_explanation(PublishExplanationRequest {
            title: "How the default value is produced".to_owned(),
            summary: "One helper owns the default.".to_owned(),
            topic: "Explain the default value".to_owned(),
            steps: vec![StepInput {
                id: "value".to_owned(),
                path: "src/lib.rs".to_owned(),
                start_line: 1,
                end_line: 3,
                title: "The helper".to_owned(),
                explanation: "Callers read the default from here.".to_owned(),
                flow_after: Vec::new(),
                symbol: None,
            }],
            agent: AgentKind::Codex,
            session_id: None,
        })
        .unwrap();

    assert_eq!(result.changed_hunk_count, 0);
    assert!(result.warnings.is_empty());
    let walkthrough: Walkthrough =
        serde_json::from_slice(&fs::read(result.session_path).unwrap()).unwrap();
    assert_eq!(walkthrough.kind, WalkthroughKind::Explanation);
    assert_eq!(walkthrough.steps[0].change_kind, ChangeKind::Context);
    assert_eq!(walkthrough.steps[0].anchor.normalized_hash.len(), 64);
    assert_eq!(service.pending_task_count().unwrap(), 0);
}

#[test]
fn an_explanation_needs_no_task_and_leaves_none_behind() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    initialize_repository(workspace.path());
    let service = CodeWalkService::new(
        workspace.path(),
        Storage::new(state.path().to_owned()).unwrap(),
    )
    .unwrap();
    let task = service
        .begin_task(BeginTaskRequest {
            goal: "An unrelated change".to_owned(),
            title: None,
            agent: AgentKind::Other,
            session_id: None,
        })
        .unwrap();

    service
        .publish_explanation(PublishExplanationRequest {
            title: "How the default value is produced".to_owned(),
            summary: "One helper owns the default.".to_owned(),
            topic: "Explain the default value".to_owned(),
            steps: vec![StepInput {
                id: "value".to_owned(),
                path: "src/lib.rs".to_owned(),
                start_line: 1,
                end_line: 3,
                title: "The helper".to_owned(),
                explanation: "Callers read the default from here.".to_owned(),
                flow_after: Vec::new(),
                symbol: None,
            }],
            agent: AgentKind::Other,
            session_id: None,
        })
        .unwrap();

    assert!(
        service.get_status(&task.task_id).unwrap().exists,
        "an explanation must not consume an unrelated task baseline"
    );
}

#[test]
fn marks_a_step_outside_the_change_set_as_context() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    initialize_repository(workspace.path());
    fs::write(
        workspace.path().join("src/caller.rs"),
        "pub fn caller() {\n    let _ = crate::value();\n}\n",
    )
    .unwrap();
    let service = CodeWalkService::new(
        workspace.path(),
        Storage::new(state.path().to_owned()).unwrap(),
    )
    .unwrap();
    let task = service
        .begin_task(BeginTaskRequest {
            goal: "Change the default".to_owned(),
            title: None,
            agent: AgentKind::Other,
            session_id: None,
        })
        .unwrap();
    fs::write(
        workspace.path().join("src/lib.rs"),
        "pub fn value() -> i32 {\n    6\n}\n",
    )
    .unwrap();

    let result = service
        .publish_walkthrough(PublishWalkthroughRequest {
            task_id: Some(task.task_id),
            title: "Change the default".to_owned(),
            summary: "The default changed, and here is who reads it.".to_owned(),
            steps: vec![
                StepInput {
                    id: "value".to_owned(),
                    path: "src/lib.rs".to_owned(),
                    start_line: 2,
                    end_line: 2,
                    title: "The new default".to_owned(),
                    explanation: "The helper returns the updated default.".to_owned(),
                    flow_after: Vec::new(),
                    symbol: None,
                },
                StepInput {
                    id: "caller".to_owned(),
                    path: "src/caller.rs".to_owned(),
                    start_line: 2,
                    end_line: 2,
                    title: "Who reads it".to_owned(),
                    explanation: "This caller is unchanged but shows the effect.".to_owned(),
                    flow_after: vec!["value".to_owned()],
                    symbol: None,
                },
            ],
            goal: None,
            agent: AgentKind::Other,
            session_id: None,
        })
        .unwrap();

    let walkthrough: Walkthrough =
        serde_json::from_slice(&fs::read(result.session_path).unwrap()).unwrap();
    let caller = walkthrough
        .steps
        .iter()
        .find(|step| step.id == "caller")
        .unwrap();
    assert_eq!(caller.change_kind, ChangeKind::Context);
    assert_eq!(walkthrough.kind, WalkthroughKind::Change);
}

fn initialize_repository(workspace: &Path) {
    fs::create_dir_all(workspace.join("src")).unwrap();
    fs::write(
        workspace.join("src/lib.rs"),
        "pub fn value() -> i32 {\n    1\n}\n",
    )
    .unwrap();
    git(workspace, &["init", "-q"]);
    git(workspace, &["config", "user.name", "Agent CodeWalk Tests"]);
    git(
        workspace,
        &["config", "user.email", "tests@example.invalid"],
    );
    git(workspace, &["add", "."]);
    git(workspace, &["commit", "-qm", "initial"]);
}

fn git(workspace: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(workspace)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
