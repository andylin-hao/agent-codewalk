use std::io::{self, BufRead, Write};

use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    CodeWalkError, CodeWalkService, Result,
    model::{
        BeginTaskRequest, PublishExplanationRequest, PublishWalkthroughRequest, TaskIdRequest,
    },
};

const MCP_PROTOCOL_VERSION: &str = "2025-06-18";

/// The workflow, sent during `initialize`.
///
/// The portable skill file carries the same guidance, but not every agent loads skills
/// from a shared directory. Server instructions reach any MCP client, so this text is
/// what makes the tools usable rather than merely available.
const INSTRUCTIONS: &str = "\
Agent CodeWalk turns work on a codebase into a walkthrough the user steps through in \
VS Code or Cursor, with each block highlighted in place.

If the task CHANGES files:
1. Immediately before the first file mutation, call begin_task with the user's concrete \
goal. Keep the returned taskId.
2. Make the changes, run the tests, and update the documentation as usual.
3. After verification, call publish_walkthrough with one step per code block a reader \
should look at. Use workspace-relative paths and current 1-based line ranges, and \
explain what changed, why, and what the block now controls.
4. Every changed text hunk must overlap at least one step. Publication fails and names \
the uncovered hunks if one does not; add steps and retry.
5. Call abort_task if the task is canceled or ends without file changes.

If the task EXPLAINS code without changing it -- analyze, explain, review, trace, walk \
me through, how does X work, where does Y happen -- call publish_explanation instead. It \
needs no begin_task and no baseline. Give the answer in the summary, then one step per \
block the reader must see, in the order that makes the mechanism clear. Still answer in \
the conversation; the walkthrough is how the user reads the code alongside it.

In both cases, use flowAfter only for genuine runtime or data-flow predecessors; file \
order is computed for you. Do not write walkthrough files by hand.";

#[derive(Debug, Deserialize)]
struct ToolCall {
    name: String,
    #[serde(default)]
    arguments: Value,
}

/// Serves newline-delimited MCP JSON-RPC messages over stdin and stdout.
///
/// # Errors
///
/// Returns an error when stdin, stdout, JSON serialization, or a tool operation fails.
pub fn serve(service: &CodeWalkService) -> Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line.map_err(|error| CodeWalkError::io("stdin", error))?;
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                write_message(
                    &mut stdout,
                    &rpc_error(&Value::Null, -32700, &format!("invalid JSON: {error}")),
                )?;
                continue;
            }
        };
        if let Some(response) = handle_request(service, &request) {
            write_message(&mut stdout, &response)?;
        }
    }
    Ok(())
}

fn handle_request(service: &CodeWalkService, request: &Value) -> Option<Value> {
    let identifier = request.get("id")?;
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let result: Result<Value> = match method {
        "initialize" => Ok(json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": {
                "name": "agent-codewalk",
                "title": "Agent CodeWalk",
                "version": env!("CARGO_PKG_VERSION")
            },
            "instructions": INSTRUCTIONS
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => Ok(
            match call_tool(
                service,
                request.get("params").cloned().unwrap_or(Value::Null),
            ) {
                Ok(value) => value,
                Err(error) => tool_error(&error.to_string()),
            },
        ),
        _ => {
            return Some(rpc_error(
                identifier,
                -32601,
                &format!("method not found: {method}"),
            ));
        }
    };
    Some(match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": identifier, "result": value }),
        Err(error) => rpc_error(identifier, -32602, &error.to_string()),
    })
}

fn call_tool(service: &CodeWalkService, params: Value) -> Result<Value> {
    let call: ToolCall = serde_json::from_value(params)?;
    let result = match call.name.as_str() {
        "begin_task" => {
            let request: BeginTaskRequest = serde_json::from_value(call.arguments)?;
            serde_json::to_value(service.begin_task(request)?)?
        }
        "publish_walkthrough" => {
            let request: PublishWalkthroughRequest = serde_json::from_value(call.arguments)?;
            serde_json::to_value(service.publish_walkthrough(request)?)?
        }
        "publish_explanation" => {
            let request: PublishExplanationRequest = serde_json::from_value(call.arguments)?;
            serde_json::to_value(service.publish_explanation(request)?)?
        }
        "abort_task" => {
            let request: TaskIdRequest = serde_json::from_value(call.arguments)?;
            serde_json::to_value(service.abort_task(&request.task_id)?)?
        }
        "get_status" => {
            let request: TaskIdRequest = serde_json::from_value(call.arguments)?;
            serde_json::to_value(service.get_status(&request.task_id)?)?
        }
        _ => {
            return Err(CodeWalkError::InvalidRequest(format!(
                "unknown tool: {}",
                call.name
            )));
        }
    };
    let text = serde_json::to_string_pretty(&result)?;
    Ok(json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": result,
        "isError": false
    }))
}

fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "begin_task",
            "title": "Begin code walkthrough task",
            "description": "Record a lightweight local baseline immediately before the first file mutation in a coding task. Returns the preferred taskId for publish_walkthrough.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["goal"],
                "properties": {
                    "goal": { "type": "string", "minLength": 1 },
                    "title": { "type": "string" },
                    "agent": { "enum": ["codex", "claude-code", "opencode", "other"] },
                    "sessionId": { "type": "string", "minLength": 1 }
                }
            }
        }),
        json!({
            "name": "publish_walkthrough",
            "title": "Publish code walkthrough",
            "description": "Validate and publish a complete walkthrough after code changes and verification. Each changed text hunk must overlap at least one step. Omit taskId only for an explicitly degraded publication when begin_task was missed.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["title", "summary", "steps"],
                "properties": {
                    "taskId": { "type": "string", "minLength": 1, "description": "The identifier from begin_task. Omit only if mutation already started without a baseline; the session will be marked degraded." },
                    "title": { "type": "string", "minLength": 1, "maxLength": 200 },
                    "summary": { "type": "string", "minLength": 1, "maxLength": 10000 },
                    "goal": { "type": "string", "minLength": 1, "description": "Original task goal used only for a degraded publication without taskId." },
                    "agent": { "enum": ["codex", "claude-code", "opencode", "other"] },
                    "sessionId": { "type": "string", "minLength": 1 },
                    "steps": steps_schema()
                }
            }
        }),
        json!({
            "name": "publish_explanation",
            "title": "Publish code explanation walkthrough",
            "description": "Publish a navigable explanation of existing code, for a request to analyze, explain, review, trace, or walk through how something works when no files are being changed. The user steps through the explanation in their editor with each block highlighted, instead of reading a wall of prose. Requires no begin_task and no baseline; every step must point at code that exists right now. Use publish_walkthrough instead when the task modified files.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["title", "summary", "topic", "steps"],
                "properties": {
                    "title": { "type": "string", "minLength": 1, "maxLength": 200 },
                    "summary": { "type": "string", "minLength": 1, "maxLength": 10000, "description": "The answer in a few sentences, for a reader who has not opened a file yet." },
                    "topic": { "type": "string", "minLength": 1, "description": "The question this explanation answers, in the user's terms." },
                    "agent": { "enum": ["codex", "claude-code", "opencode", "other"] },
                    "sessionId": { "type": "string", "minLength": 1 },
                    "steps": steps_schema()
                }
            }
        }),
        task_tool(
            "abort_task",
            "Abort code walkthrough task",
            "Idempotently delete an unpublished task baseline.",
        ),
        task_tool(
            "get_status",
            "Get code walkthrough task status",
            "Check whether a task baseline still exists in the current workspace.",
        ),
    ]
}

/// The step array both publication tools accept.
fn steps_schema() -> Value {
    json!({
        "type": "array",
        "minItems": 1,
        "maxItems": 500,
        "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["id", "path", "startLine", "endLine", "title", "explanation"],
            "properties": {
                "id": { "type": "string", "minLength": 1, "maxLength": 100 },
                "path": { "type": "string", "minLength": 1, "description": "Workspace-relative path." },
                "startLine": { "type": "integer", "minimum": 1 },
                "endLine": { "type": "integer", "minimum": 1 },
                "title": { "type": "string", "minLength": 1, "maxLength": 200 },
                "explanation": { "type": "string", "minLength": 1, "maxLength": 10000 },
                "flowAfter": {
                    "type": "array",
                    "items": { "type": "string", "minLength": 1 },
                    "uniqueItems": true,
                    "description": "Steps that must be understood before this one, for the execution-flow order."
                },
                "symbol": { "type": "string", "minLength": 1 }
            }
        }
    })
}

fn task_tool(name: &str, title: &str, description: &str) -> Value {
    json!({
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": {
            "type": "object",
            "additionalProperties": false,
            "required": ["taskId"],
            "properties": { "taskId": { "type": "string", "minLength": 1 } }
        }
    })
}

fn rpc_error(identifier: &Value, code: i32, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": identifier,
        "error": { "code": code, "message": message }
    })
}

fn tool_error(message: &str) -> Value {
    json!({
        "content": [{ "type": "text", "text": message }],
        "isError": true
    })
}

fn write_message(writer: &mut impl Write, message: &Value) -> Result<()> {
    let serialized = serde_json::to_string(message)?;
    writeln!(writer, "{serialized}").map_err(|error| CodeWalkError::io("stdout", error))?;
    writer
        .flush()
        .map_err(|error| CodeWalkError::io("stdout", error))
}

#[cfg(test)]
mod tests {
    use super::handle_request;
    use crate::{CodeWalkService, storage::Storage};
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn lists_every_public_tool() {
        let workspace = tempdir().unwrap();
        let state = tempdir().unwrap();
        let service = CodeWalkService::new(
            workspace.path(),
            Storage::new(state.path().to_owned()).unwrap(),
        )
        .unwrap();
        let response = handle_request(
            &service,
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
        )
        .unwrap();
        let names: Vec<&str> = response["result"]["tools"]
            .as_array()
            .unwrap()
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
    }

    #[test]
    fn describes_publish_explanation_in_the_words_a_user_would_use() {
        let workspace = tempdir().unwrap();
        let state = tempdir().unwrap();
        let service = CodeWalkService::new(
            workspace.path(),
            Storage::new(state.path().to_owned()).unwrap(),
        )
        .unwrap();
        let response = handle_request(
            &service,
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
        )
        .unwrap();
        let description = response["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "publish_explanation")
            .and_then(|tool| tool["description"].as_str())
            .unwrap()
            .to_lowercase();
        for trigger in [
            "analyze",
            "explain",
            "trace",
            "walk through",
            "how something works",
        ] {
            assert!(
                description.contains(trigger),
                "the description must mention {trigger}"
            );
        }
    }

    #[test]
    fn instructions_cover_both_publication_paths() {
        let workspace = tempdir().unwrap();
        let state = tempdir().unwrap();
        let service = CodeWalkService::new(
            workspace.path(),
            Storage::new(state.path().to_owned()).unwrap(),
        )
        .unwrap();
        let response = handle_request(
            &service,
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
        )
        .unwrap();
        let instructions = response["result"]["instructions"].as_str().unwrap();
        assert!(instructions.contains("publish_walkthrough"));
        assert!(instructions.contains("publish_explanation"));
        assert!(instructions.contains("no begin_task"));
    }

    #[test]
    fn returns_tool_failures_as_mcp_error_content() {
        let workspace = tempdir().unwrap();
        let state = tempdir().unwrap();
        let service = CodeWalkService::new(
            workspace.path(),
            Storage::new(state.path().to_owned()).unwrap(),
        )
        .unwrap();
        let response = handle_request(
            &service,
            &json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": { "name": "get_status", "arguments": {} }
            }),
        )
        .unwrap();
        assert_eq!(response["result"]["isError"], true);
        assert!(response["result"]["content"][0]["text"].is_string());
    }
}
