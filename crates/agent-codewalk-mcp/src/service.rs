use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use chrono::Utc;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    CodeWalkError, Result,
    baseline::{
        calculate_changes, create_baseline, create_degraded_baseline, detect_renamed_destinations,
        resolve_workspace_path, validate_non_empty,
    },
    model::{
        BeginTaskRequest, BeginTaskResult, ChangeHunk, ChangeKind, CodeAnchor,
        PublishWalkthroughRequest, PublishWalkthroughResult, StepInput, TaskStatusResult,
        Walkthrough, WalkthroughAgent, WalkthroughStep, WalkthroughTask,
    },
    storage::Storage,
};

const MAX_STEPS: usize = 500;
const MAX_IDENTIFIER_CHARACTERS: usize = 100;
const MAX_TITLE_CHARACTERS: usize = 200;
const MAX_EXPLANATION_CHARACTERS: usize = 10_000;

/// Implements task capture and walkthrough publication independently from MCP transport.
#[derive(Clone, Debug)]
pub struct CodeWalkService {
    workspace_root: PathBuf,
    storage: Storage,
}

impl CodeWalkService {
    /// Creates a service for the process working directory and platform data directory.
    ///
    /// # Errors
    ///
    /// Returns an error when either directory cannot be resolved or initialized.
    pub fn from_environment() -> Result<Self> {
        let workspace_root = std::env::current_dir()
            .map_err(|error| CodeWalkError::io("current directory", error))?;
        Self::new(&workspace_root, Storage::from_environment()?)
    }

    /// Creates a service rooted at an explicit workspace.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace cannot be canonicalized.
    pub fn new(workspace_root: &Path, storage: Storage) -> Result<Self> {
        let workspace_root = workspace_root
            .canonicalize()
            .map_err(|error| CodeWalkError::io(workspace_root, error))?;
        Ok(Self {
            workspace_root,
            storage,
        })
    }

    /// Records the repository state immediately before a coding task mutates files.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid input, inaccessible files, or failed Git operations.
    pub fn begin_task(&self, request: BeginTaskRequest) -> Result<BeginTaskResult> {
        let (manifest, warnings) = create_baseline(&self.storage, &self.workspace_root, request)?;
        Ok(BeginTaskResult {
            task_id: manifest.id,
            workspace_root: manifest.workspace_root,
            started_at: manifest.started_at,
            degraded_baseline: manifest.degraded_baseline,
            warnings,
        })
    }

    /// Validates and persists a complete walkthrough for a recorded task.
    ///
    /// # Errors
    ///
    /// Returns an error when the task is missing, the protocol is invalid, or changed hunks are
    /// not covered by the supplied steps.
    pub fn publish_walkthrough(
        &self,
        request: PublishWalkthroughRequest,
    ) -> Result<PublishWalkthroughResult> {
        validate_publish_request(&request)?;
        let manifest = if let Some(task_id) = request.task_id.as_deref() {
            self.storage.read_manifest(&self.workspace_root, task_id)?
        } else {
            create_degraded_baseline(
                &self.workspace_root,
                request
                    .goal
                    .clone()
                    .unwrap_or_else(|| request.title.clone()),
                request.agent.clone(),
                request.session_id.clone(),
            )
        };
        if Path::new(&manifest.workspace_root) != self.workspace_root {
            return Err(CodeWalkError::InvalidRequest(
                "task baseline belongs to a different workspace".to_owned(),
            ));
        }

        let changes = calculate_changes(&self.storage, &self.workspace_root, &manifest)?;
        if changes.hunks.is_empty() && changes.excluded.is_empty() && !manifest.degraded_baseline {
            return Err(CodeWalkError::InvalidRequest(
                "no changes were found relative to the task baseline".to_owned(),
            ));
        }
        validate_coverage(&request.steps, &changes.hunks, manifest.degraded_baseline)?;
        let renamed = detect_renamed_destinations(&self.workspace_root, manifest.head.as_deref());

        let mut steps = Vec::with_capacity(request.steps.len());
        for input in request.steps {
            steps.push(self.enrich_step(input, &changes.hunks, &renamed)?);
        }
        let file_order = file_order(&steps);
        let flow_order = flow_order(&steps, &file_order)?;
        let completed_at = Utc::now().to_rfc3339();
        let walkthrough_id = Uuid::new_v4().to_string();
        let walkthrough = Walkthrough {
            schema_version: 1,
            id: walkthrough_id.clone(),
            workspace_fingerprint: Storage::workspace_fingerprint(&self.workspace_root),
            title: request.title,
            summary: request.summary,
            agent: WalkthroughAgent {
                kind: manifest.agent,
                session_id: manifest.session_id,
            },
            task: WalkthroughTask {
                id: manifest.id.clone(),
                goal: manifest.goal,
                started_at: manifest.started_at,
                completed_at: completed_at.clone(),
            },
            created_at: completed_at,
            steps,
            file_order,
            flow_order,
            changed_hunks: changes.hunks,
            excluded_changes: changes.excluded.clone(),
            degraded_baseline: manifest.degraded_baseline,
        };
        let session_path =
            self.storage
                .write_session(&self.workspace_root, &walkthrough_id, &walkthrough)?;
        self.storage
            .delete_task(&self.workspace_root, &manifest.id)?;

        let mut warnings = Vec::new();
        if walkthrough.degraded_baseline {
            warnings
                .push("The walkthrough was published without a complete Git baseline.".to_owned());
        }
        if !walkthrough.excluded_changes.is_empty() {
            warnings.push(
                "Some binary, large, or unsupported changes are listed but not highlighted."
                    .to_owned(),
            );
        }
        Ok(PublishWalkthroughResult {
            walkthrough_id,
            session_path: session_path.to_string_lossy().into_owned(),
            step_count: walkthrough.steps.len(),
            changed_hunk_count: walkthrough.changed_hunks.len(),
            excluded_changes: walkthrough.excluded_changes,
            warnings,
        })
    }

    /// Idempotently removes an unpublished task baseline.
    ///
    /// # Errors
    ///
    /// Returns an error when the task identifier is invalid or local state cannot be removed.
    pub fn abort_task(&self, task_id: &str) -> Result<TaskStatusResult> {
        validate_non_empty("taskId", task_id)?;
        let existed = self.storage.task_exists(&self.workspace_root, task_id);
        self.storage.delete_task(&self.workspace_root, task_id)?;
        Ok(TaskStatusResult {
            task_id: task_id.to_owned(),
            exists: existed,
            workspace_root: self.workspace_root.to_string_lossy().into_owned(),
        })
    }

    /// Reports whether a task baseline exists in this workspace.
    ///
    /// # Errors
    ///
    /// Returns an error when the task identifier is empty.
    pub fn get_status(&self, task_id: &str) -> Result<TaskStatusResult> {
        validate_non_empty("taskId", task_id)?;
        Ok(TaskStatusResult {
            task_id: task_id.to_owned(),
            exists: self.storage.task_exists(&self.workspace_root, task_id),
            workspace_root: self.workspace_root.to_string_lossy().into_owned(),
        })
    }

    #[must_use]
    pub fn workspace_root(&self) -> &Path {
        &self.workspace_root
    }

    /// Returns the number of unpublished task baselines for this workspace.
    ///
    /// # Errors
    ///
    /// Returns an error when the task storage directory cannot be read.
    pub fn pending_task_count(&self) -> Result<usize> {
        self.storage.pending_task_count(&self.workspace_root)
    }

    fn enrich_step(
        &self,
        input: StepInput,
        hunks: &[ChangeHunk],
        renamed: &BTreeSet<String>,
    ) -> Result<WalkthroughStep> {
        let normalized_path = input.path.replace('\\', "/");
        let absolute_path = resolve_workspace_path(&self.workspace_root, &normalized_path)?;
        let (target_available, anchor) = if absolute_path.is_file() {
            let content = fs::read_to_string(&absolute_path)
                .map_err(|error| CodeWalkError::io(&absolute_path, error))?;
            (true, make_anchor(&content, &input)?)
        } else {
            if input.start_line != 1 || input.end_line != 1 {
                return Err(CodeWalkError::InvalidRequest(format!(
                    "deleted target {} must use the fallback range 1..1",
                    input.path
                )));
            }
            (false, make_deleted_anchor(&input))
        };
        let change_kind = if renamed.contains(&normalized_path) {
            ChangeKind::Rename
        } else {
            infer_change_kind(&normalized_path, input.start_line, input.end_line, hunks)
        };
        Ok(WalkthroughStep {
            id: input.id,
            path: normalized_path,
            title: input.title,
            explanation: input.explanation,
            change_kind,
            anchor,
            flow_after: input.flow_after,
            target_available,
        })
    }
}

fn validate_publish_request(request: &PublishWalkthroughRequest) -> Result<()> {
    if let Some(task_id) = &request.task_id {
        validate_non_empty("taskId", task_id)?;
    }
    if let Some(goal) = &request.goal {
        validate_non_empty("goal", goal)?;
    }
    validate_non_empty("title", &request.title)?;
    validate_non_empty("summary", &request.summary)?;
    if request.title.chars().count() > MAX_TITLE_CHARACTERS {
        return Err(CodeWalkError::InvalidRequest(format!(
            "title must contain at most {MAX_TITLE_CHARACTERS} characters"
        )));
    }
    if request.summary.chars().count() > MAX_EXPLANATION_CHARACTERS {
        return Err(CodeWalkError::InvalidRequest(format!(
            "summary must contain at most {MAX_EXPLANATION_CHARACTERS} characters"
        )));
    }
    if request.steps.is_empty() {
        return Err(CodeWalkError::InvalidRequest(
            "at least one walkthrough step is required".to_owned(),
        ));
    }
    if request.steps.len() > MAX_STEPS {
        return Err(CodeWalkError::InvalidRequest(format!(
            "a walkthrough may contain at most {MAX_STEPS} steps"
        )));
    }
    let mut identifiers = BTreeSet::new();
    for step in &request.steps {
        validate_non_empty("step.id", &step.id)?;
        validate_non_empty("step.path", &step.path)?;
        validate_non_empty("step.title", &step.title)?;
        validate_non_empty("step.explanation", &step.explanation)?;
        if step.id.chars().count() > MAX_IDENTIFIER_CHARACTERS {
            return Err(CodeWalkError::InvalidRequest(format!(
                "step id must contain at most {MAX_IDENTIFIER_CHARACTERS} characters"
            )));
        }
        if step.title.chars().count() > MAX_TITLE_CHARACTERS {
            return Err(CodeWalkError::InvalidRequest(format!(
                "step title must contain at most {MAX_TITLE_CHARACTERS} characters"
            )));
        }
        if step.explanation.chars().count() > MAX_EXPLANATION_CHARACTERS {
            return Err(CodeWalkError::InvalidRequest(format!(
                "step explanation must contain at most {MAX_EXPLANATION_CHARACTERS} characters"
            )));
        }
        if !identifiers.insert(&step.id) {
            return Err(CodeWalkError::InvalidRequest(format!(
                "duplicate step id: {}",
                step.id
            )));
        }
        if step.start_line == 0 || step.end_line < step.start_line {
            return Err(CodeWalkError::InvalidRequest(format!(
                "step {} has an invalid line range",
                step.id
            )));
        }
        let mut predecessors = BTreeSet::new();
        if step
            .flow_after
            .iter()
            .any(|predecessor| !predecessors.insert(predecessor))
        {
            return Err(CodeWalkError::InvalidRequest(format!(
                "step {} contains duplicate flowAfter entries",
                step.id
            )));
        }
    }
    Ok(())
}

fn validate_coverage(steps: &[StepInput], hunks: &[ChangeHunk], degraded: bool) -> Result<()> {
    if degraded {
        return Ok(());
    }
    let uncovered: Vec<String> = hunks
        .iter()
        .filter(|hunk| {
            !steps.iter().any(|step| {
                step.path.replace('\\', "/") == hunk.path
                    && ranges_overlap(
                        step.start_line,
                        step.end_line,
                        hunk.start_line,
                        hunk.end_line,
                    )
            })
        })
        .map(|hunk| format!("{}:{}-{}", hunk.path, hunk.start_line, hunk.end_line))
        .collect();
    if uncovered.is_empty() {
        Ok(())
    } else {
        Err(CodeWalkError::IncompleteCoverage(uncovered.join(", ")))
    }
}

fn ranges_overlap(left_start: u32, left_end: u32, right_start: u32, right_end: u32) -> bool {
    left_start <= right_end && right_start <= left_end
}

fn make_anchor(content: &str, input: &StepInput) -> Result<CodeAnchor> {
    let lines: Vec<&str> = content.lines().collect();
    if input.end_line as usize > lines.len().max(1) {
        return Err(CodeWalkError::InvalidRequest(format!(
            "step {} ends at line {}, but {} has {} lines",
            input.id,
            input.end_line,
            input.path,
            lines.len()
        )));
    }
    let selected = if lines.is_empty() {
        String::new()
    } else {
        lines[(input.start_line - 1) as usize..input.end_line as usize].join("\n")
    };
    Ok(CodeAnchor {
        start_line: input.start_line,
        end_line: input.end_line,
        line_count: input.end_line - input.start_line + 1,
        normalized_hash: hash_text(&selected),
        symbol: input.symbol.clone(),
    })
}

fn make_deleted_anchor(input: &StepInput) -> CodeAnchor {
    CodeAnchor {
        start_line: 1,
        end_line: 1,
        line_count: 1,
        normalized_hash: hash_text(""),
        symbol: input.symbol.clone(),
    }
}

fn hash_text(value: &str) -> String {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    hex::encode(Sha256::digest(normalized.as_bytes()))
}

fn infer_change_kind(
    path: &str,
    start_line: u32,
    end_line: u32,
    hunks: &[ChangeHunk],
) -> ChangeKind {
    let matching: Vec<ChangeKind> = hunks
        .iter()
        .filter(|hunk| {
            hunk.path == path
                && ranges_overlap(start_line, end_line, hunk.start_line, hunk.end_line)
        })
        .map(|hunk| hunk.kind)
        .collect();
    if matching.contains(&ChangeKind::Modify) || matching.len() > 1 {
        ChangeKind::Modify
    } else {
        matching.first().copied().unwrap_or(ChangeKind::Modify)
    }
}

fn file_order(steps: &[WalkthroughStep]) -> Vec<String> {
    let mut positions: Vec<(&str, u32, &str)> = steps
        .iter()
        .map(|step| (step.path.as_str(), step.anchor.start_line, step.id.as_str()))
        .collect();
    positions.sort_unstable();
    positions
        .into_iter()
        .map(|(_, _, identifier)| identifier.to_owned())
        .collect()
}

fn flow_order(steps: &[WalkthroughStep], stable_order: &[String]) -> Result<Vec<String>> {
    let identifiers: BTreeSet<&str> = steps.iter().map(|step| step.id.as_str()).collect();
    let mut outgoing: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut indegree: BTreeMap<&str, usize> = identifiers
        .iter()
        .copied()
        .map(|identifier| (identifier, 0))
        .collect();
    for step in steps {
        for predecessor in &step.flow_after {
            if predecessor == &step.id {
                return Err(CodeWalkError::InvalidRequest(format!(
                    "step {} cannot depend on itself",
                    step.id
                )));
            }
            if !identifiers.contains(predecessor.as_str()) {
                return Err(CodeWalkError::InvalidRequest(format!(
                    "step {} references an unknown predecessor: {predecessor}",
                    step.id
                )));
            }
            outgoing
                .entry(predecessor.as_str())
                .or_default()
                .push(step.id.as_str());
            *indegree.entry(step.id.as_str()).or_default() += 1;
        }
    }
    let rank: BTreeMap<&str, usize> = stable_order
        .iter()
        .enumerate()
        .map(|(index, identifier)| (identifier.as_str(), index))
        .collect();
    let mut ready: Vec<&str> = indegree
        .iter()
        .filter_map(|(identifier, degree)| (*degree == 0).then_some(*identifier))
        .collect();
    ready.sort_by_key(|identifier| rank.get(identifier).copied().unwrap_or(usize::MAX));
    let mut result = Vec::with_capacity(steps.len());
    while let Some(identifier) = ready.first().copied() {
        ready.remove(0);
        result.push(identifier.to_owned());
        for successor in outgoing.get(identifier).into_iter().flatten() {
            let degree = indegree.get_mut(successor).expect("known successor");
            *degree -= 1;
            if *degree == 0 {
                ready.push(successor);
            }
        }
        ready.sort_by_key(|candidate| rank.get(candidate).copied().unwrap_or(usize::MAX));
    }
    if result.len() != steps.len() {
        return Err(CodeWalkError::InvalidRequest(
            "execution-flow dependencies contain a cycle".to_owned(),
        ));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{flow_order, make_anchor};
    use crate::model::{ChangeKind, CodeAnchor, StepInput, WalkthroughStep};

    fn step(id: &str, flow_after: &[&str]) -> WalkthroughStep {
        WalkthroughStep {
            id: id.to_owned(),
            path: format!("{id}.rs"),
            title: id.to_owned(),
            explanation: id.to_owned(),
            change_kind: ChangeKind::Modify,
            anchor: CodeAnchor {
                start_line: 1,
                end_line: 1,
                line_count: 1,
                normalized_hash: "0".repeat(64),
                symbol: None,
            },
            flow_after: flow_after.iter().map(|value| (*value).to_owned()).collect(),
            target_available: true,
        }
    }

    #[test]
    fn topologically_sorts_flow_with_file_order_as_tie_breaker() {
        let steps = vec![step("b", &["a"]), step("a", &[]), step("c", &[])];
        let order = flow_order(&steps, &["c".to_owned(), "a".to_owned(), "b".to_owned()]).unwrap();
        assert_eq!(order, vec!["c", "a", "b"]);
    }

    #[test]
    fn hashes_the_selected_code_range() {
        let input = StepInput {
            id: "one".to_owned(),
            path: "file.rs".to_owned(),
            start_line: 2,
            end_line: 2,
            title: "title".to_owned(),
            explanation: "why".to_owned(),
            flow_after: Vec::new(),
            symbol: None,
        };
        let anchor = make_anchor("first\nsecond\n", &input).unwrap();
        assert_eq!(anchor.line_count, 1);
        assert_ne!(anchor.normalized_hash, "0".repeat(64));
    }
}
