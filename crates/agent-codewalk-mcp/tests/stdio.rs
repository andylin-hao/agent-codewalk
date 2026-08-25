//! End-to-end coverage of the shipped binary.
//!
//! Everything else exercises the library. This drives the real executable the way an
//! agent does: line-delimited JSON-RPC over stdin and stdout, in a real Git repository,
//! writing a session an editor can then read.

use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};

use agent_codewalk_mcp::{
    model::{ChangeKind, Walkthrough, WalkthroughKind},
    storage::Storage,
};
use serde_json::{Value, json};
use tempfile::tempdir;

struct Companion {
    process: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    next_id: u64,
}

impl Companion {
    fn start(working_directory: &Path, state: &Path) -> Self {
        let mut process = Command::new(env!("CARGO_BIN_EXE_agent-codewalk-mcp"))
            .current_dir(working_directory)
            .env("AGENT_CODEWALK_HOME", state)
            .env_remove("AGENT_CODEWALK_WORKSPACE")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("the companion binary must start");
        let input = process.stdin.take().expect("stdin is piped");
        let output = BufReader::new(process.stdout.take().expect("stdout is piped"));
        Self {
            process,
            input,
            output,
            next_id: 0,
        }
    }

    fn request(&mut self, method: &str, params: &Value) -> Value {
        self.next_id += 1;
        let message = json!({
            "jsonrpc": "2.0",
            "id": self.next_id,
            "method": method,
            "params": params,
        });
        writeln!(self.input, "{message}").expect("the companion must accept a request");
        self.input.flush().expect("the request must be flushed");
        let mut line = String::new();
        self.output
            .read_line(&mut line)
            .expect("the companion must answer");
        serde_json::from_str(&line).expect("the answer must be JSON")
    }

    fn call_tool(&mut self, name: &str, arguments: &Value) -> Value {
        let response = self.request(
            "tools/call",
            &json!({ "name": name, "arguments": arguments }),
        );
        let result = response
            .get("result")
            .unwrap_or_else(|| panic!("{name} failed: {response}"))
            .clone();
        assert_eq!(
            result.get("isError").and_then(Value::as_bool),
            Some(false),
            "{name} reported an error: {result}"
        );
        result["structuredContent"].clone()
    }

    fn shutdown(mut self) {
        drop(self.input);
        let _ = self.process.wait();
    }
}

#[test]
fn publishes_a_session_an_editor_can_load_when_started_in_a_subdirectory() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    let repository = workspace.path();
    initialize_repository(repository);
    let nested = repository.join("packages").join("app");
    fs::create_dir_all(&nested).unwrap();

    let mut companion = Companion::start(&nested, state.path());

    let initialize = companion.request("initialize", &json!({}));
    assert_eq!(
        initialize["result"]["serverInfo"]["name"].as_str(),
        Some("agent-codewalk")
    );

    let tools = companion.request("tools/list", &json!({}));
    let names: Vec<&str> = tools["result"]["tools"]
        .as_array()
        .expect("tools must be listed")
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert_eq!(
        names,
        vec![
            "begin_task",
            "publish_walkthrough",
            "publish_explanation",
            "abort_task",
            "get_status"
        ]
    );

    let begin = companion.call_tool(
        "begin_task",
        &json!({ "goal": "Change the default value", "agent": "codex" }),
    );
    assert_eq!(begin["degradedBaseline"].as_bool(), Some(false));
    assert_eq!(
        begin["workspaceRoot"].as_str().map(canonical),
        Some(canonical(repository.to_str().unwrap())),
        "the repository root must win over the working directory"
    );
    let task_id = begin["taskId"].as_str().expect("taskId").to_owned();

    fs::write(
        repository.join("src/lib.rs"),
        "pub fn value() -> i32 {\n    5\n}\n",
    )
    .unwrap();

    let published = companion.call_tool(
        "publish_walkthrough",
        &json!({
            "taskId": task_id,
            "title": "Change the default",
            "summary": "The helper returns a new default.",
            "steps": [{
                "id": "value",
                "path": "src/lib.rs",
                "startLine": 2,
                "endLine": 2,
                "title": "Return the new default",
                "explanation": "Callers now observe the updated default."
            }]
        }),
    );
    assert_eq!(published["stepCount"].as_u64(), Some(1));

    let session_path = published["sessionPath"].as_str().expect("sessionPath");
    let expected_directory = state
        .path()
        .join("workspaces")
        .join(Storage::workspace_fingerprint(
            &repository.canonicalize().unwrap(),
        ))
        .join("sessions");
    assert!(
        Path::new(session_path).starts_with(&expected_directory),
        "the session must be filed under the repository fingerprint: {session_path}"
    );

    let walkthrough: Walkthrough =
        serde_json::from_slice(&fs::read(session_path).unwrap()).unwrap();
    assert_eq!(walkthrough.steps.len(), 1);
    assert_eq!(walkthrough.steps[0].path, "src/lib.rs");
    assert_eq!(walkthrough.steps[0].previous_text.as_deref(), Some("    1"));
    assert!(walkthrough.uncovered_hunks.is_empty());

    let status = companion.call_tool("get_status", &json!({ "taskId": task_id }));
    assert_eq!(status["exists"].as_bool(), Some(false));

    companion.shutdown();
}

#[test]
fn reports_an_incomplete_walkthrough_as_a_tool_error() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    initialize_repository(workspace.path());
    let mut companion = Companion::start(workspace.path(), state.path());

    let begin = companion.call_tool("begin_task", &json!({ "goal": "Change two lines" }));
    let task_id = begin["taskId"].as_str().unwrap().to_owned();
    fs::write(
        workspace.path().join("src/lib.rs"),
        "pub fn value() -> i32 {\n    2\n}\n\npub fn extra() {}\n",
    )
    .unwrap();

    let response = companion.request(
        "tools/call",
        &json!({
            "name": "publish_walkthrough",
            "arguments": {
                "taskId": task_id,
                "title": "Partial",
                "summary": "Only one hunk is explained.",
                "steps": [{
                    "id": "value",
                    "path": "src/lib.rs",
                    "startLine": 2,
                    "endLine": 2,
                    "title": "Update the value",
                    "explanation": "The default changed."
                }]
            }
        }),
    );

    let result = &response["result"];
    assert_eq!(result["isError"].as_bool(), Some(true));
    let text = result["content"][0]["text"].as_str().unwrap_or_default();
    assert!(text.contains("src/lib.rs"), "unexpected message: {text}");
    companion.shutdown();
}

#[test]
fn publishes_an_explanation_without_a_baseline_or_a_repository() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    // Deliberately not a Git repository: explaining code must not require one.
    fs::create_dir_all(workspace.path().join("src")).unwrap();
    fs::write(
        workspace.path().join("src/lib.rs"),
        "pub fn value() -> i32 {\n    1\n}\n",
    )
    .unwrap();
    let mut companion = Companion::start(workspace.path(), state.path());

    let published = companion.call_tool(
        "publish_explanation",
        &json!({
            "title": "How the default value is produced",
            "summary": "One helper owns the default and every caller reads it from there.",
            "topic": "Explain how the default value works",
            "agent": "claude-code",
            "steps": [{
                "id": "value",
                "path": "src/lib.rs",
                "startLine": 1,
                "endLine": 3,
                "title": "The helper that owns the default",
                "explanation": "Callers never hard-code the default; they read it from here."
            }]
        }),
    );
    assert_eq!(published["stepCount"].as_u64(), Some(1));
    assert_eq!(published["changedHunkCount"].as_u64(), Some(0));

    let walkthrough: Walkthrough =
        serde_json::from_slice(&fs::read(published["sessionPath"].as_str().unwrap()).unwrap())
            .unwrap();
    assert_eq!(walkthrough.kind, WalkthroughKind::Explanation);
    assert_eq!(walkthrough.task.goal, "Explain how the default value works");
    assert_eq!(walkthrough.steps[0].change_kind, ChangeKind::Context);
    assert!(walkthrough.steps[0].previous_text.is_none());
    assert!(walkthrough.changed_hunks.is_empty());
    assert!(!walkthrough.degraded_baseline);

    companion.shutdown();
}

#[test]
fn refuses_to_explain_a_file_that_does_not_exist() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    initialize_repository(workspace.path());
    let mut companion = Companion::start(workspace.path(), state.path());

    let response = companion.request(
        "tools/call",
        &json!({
            "name": "publish_explanation",
            "arguments": {
                "title": "Missing",
                "summary": "Points at a file that is not there.",
                "topic": "Explain the missing module",
                "steps": [{
                    "id": "absent",
                    "path": "src/absent.rs",
                    "startLine": 1,
                    "endLine": 1,
                    "title": "Absent",
                    "explanation": "There is nothing here."
                }]
            }
        }),
    );

    assert_eq!(response["result"]["isError"].as_bool(), Some(true));
    let text = response["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or_default();
    assert!(text.contains("src/absent.rs"), "unexpected message: {text}");
    companion.shutdown();
}

#[test]
fn rejects_an_unknown_method_without_stopping() {
    let workspace = tempdir().unwrap();
    let state = tempdir().unwrap();
    initialize_repository(workspace.path());
    let mut companion = Companion::start(workspace.path(), state.path());

    let response = companion.request("does/not/exist", &json!({}));
    assert_eq!(response["error"]["code"].as_i64(), Some(-32601));

    let ping = companion.request("ping", &json!({}));
    assert!(ping["result"].is_object(), "the server must stay usable");
    companion.shutdown();
}

fn canonical(path: &str) -> String {
    Path::new(path)
        .canonicalize()
        .unwrap_or_else(|_| Path::new(path).to_owned())
        .to_string_lossy()
        .into_owned()
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
