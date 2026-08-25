use std::{io::Read, process::ExitCode};

use agent_codewalk_mcp::{CodeWalkService, mcp};

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().collect();
    if arguments.iter().any(|argument| argument == "--version") {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }

    if arguments
        .iter()
        .any(|argument| argument == "--hook-reminder")
    {
        return hook_reminder();
    }
    if arguments
        .iter()
        .any(|argument| argument == "--prompt-reminder")
    {
        println!(
            "Use the agent-codewalk skill. If this task will change files, call begin_task immediately before the first mutation and publish_walkthrough after verification. If it explains code without changing it -- analyze, explain, review, trace, walk through -- call publish_explanation instead, with no begin_task."
        );
        return ExitCode::SUCCESS;
    }

    match CodeWalkService::from_environment().and_then(|service| mcp::serve(&service)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("agent-codewalk-mcp: {error}");
            ExitCode::FAILURE
        }
    }
}

fn hook_reminder() -> ExitCode {
    let mut input = String::new();
    if let Err(error) = std::io::stdin().read_to_string(&mut input) {
        eprintln!("agent-codewalk-mcp: cannot read hook input: {error}");
        return ExitCode::FAILURE;
    }
    let already_active = serde_json::from_str::<serde_json::Value>(&input)
        .ok()
        .and_then(|value| {
            value
                .get("stop_hook_active")
                .and_then(serde_json::Value::as_bool)
        })
        .unwrap_or(false);
    if already_active {
        println!("{{}}");
        return ExitCode::SUCCESS;
    }
    match CodeWalkService::from_environment().and_then(|service| service.pending_task_count()) {
        Ok(0) => println!("{{}}"),
        Ok(count) => {
            let reason = format!(
                "Agent CodeWalk has {count} unpublished task baseline(s). If this task changed code, call publish_walkthrough and cover every changed hunk. If it made no changes, call abort_task."
            );
            println!(
                "{}",
                serde_json::json!({ "decision": "block", "reason": reason })
            );
        }
        Err(error) => {
            eprintln!("agent-codewalk-mcp: cannot inspect pending tasks: {error}");
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}
