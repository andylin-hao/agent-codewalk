use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::Command,
};

use chrono::Utc;
use similar::{DiffTag, TextDiff};
use uuid::Uuid;

use crate::{
    CodeWalkError, Result,
    model::{
        AgentKind, BaselineManifest, BeginTaskRequest, ChangeHunk, ChangeKind, DiffResult,
        ExcludedChange, HunkDetail,
    },
    storage::Storage,
};

const MAX_TEXT_FILE_SIZE: u64 = 1024 * 1024;

pub(crate) fn create_baseline(
    storage: &Storage,
    workspace_root: &Path,
    request: BeginTaskRequest,
) -> Result<(BaselineManifest, Vec<String>)> {
    validate_non_empty("goal", &request.goal)?;
    let task_id = Uuid::new_v4().to_string();
    storage.create_task_dir(workspace_root, &task_id)?;

    let git_root = git_output(workspace_root, &["rev-parse", "--show-toplevel"])
        .ok()
        .map(|output| PathBuf::from(output.trim()));
    let mut warnings = Vec::new();
    let mut degraded_baseline = git_root.is_none();
    if degraded_baseline {
        warnings.push(
            "The workspace is not inside a Git repository; change coverage will be best-effort."
                .to_owned(),
        );
    }

    let head = if git_root.is_some() {
        if let Ok(output) = git_output(workspace_root, &["rev-parse", "HEAD"]) {
            Some(output.trim().to_owned())
        } else {
            degraded_baseline = true;
            warnings.push(
                "The repository has no HEAD commit; all existing files are treated as the baseline."
                    .to_owned(),
            );
            None
        }
    } else {
        None
    };

    let mut snapshots = BTreeMap::new();
    let mut baseline_absent = Vec::new();
    let mut excluded_snapshots = Vec::new();
    if git_root.is_some() {
        for relative_path in collect_changed_paths(workspace_root, head.as_deref())? {
            let absolute_path = resolve_workspace_path(workspace_root, &relative_path)?;
            if !absolute_path.is_file() {
                baseline_absent.push(relative_path);
                continue;
            }
            match read_text_candidate(&absolute_path) {
                Ok(content) => {
                    let snapshot_name = storage.write_snapshot(
                        workspace_root,
                        &task_id,
                        &relative_path,
                        &content,
                    )?;
                    snapshots.insert(relative_path, snapshot_name);
                }
                Err(reason) => excluded_snapshots.push(ExcludedChange {
                    path: relative_path,
                    reason,
                }),
            }
        }
    }

    let manifest = BaselineManifest {
        id: task_id,
        workspace_root: workspace_root.to_string_lossy().into_owned(),
        git_root: git_root.map(|path| path.to_string_lossy().into_owned()),
        head,
        goal: request.goal,
        title: request.title,
        agent: request.agent,
        session_id: request.session_id,
        started_at: Utc::now().to_rfc3339(),
        degraded_baseline,
        snapshots,
        baseline_absent,
        excluded_snapshots,
    };
    storage.write_manifest(workspace_root, &manifest)?;
    Ok((manifest, warnings))
}

pub(crate) fn create_degraded_baseline(
    workspace_root: &Path,
    goal: String,
    agent: AgentKind,
    session_id: Option<String>,
) -> BaselineManifest {
    let git_root = git_output(workspace_root, &["rev-parse", "--show-toplevel"])
        .ok()
        .map(|output| PathBuf::from(output.trim()));
    let head = git_root.as_ref().and_then(|_| {
        git_output(workspace_root, &["rev-parse", "HEAD"])
            .ok()
            .map(|output| output.trim().to_owned())
    });
    BaselineManifest {
        id: format!("degraded-{}", Uuid::new_v4()),
        workspace_root: workspace_root.to_string_lossy().into_owned(),
        git_root: git_root.map(|path| path.to_string_lossy().into_owned()),
        head,
        goal,
        title: None,
        agent,
        session_id,
        started_at: Utc::now().to_rfc3339(),
        degraded_baseline: true,
        snapshots: BTreeMap::new(),
        baseline_absent: Vec::new(),
        excluded_snapshots: Vec::new(),
    }
}

pub(crate) fn calculate_changes(
    storage: &Storage,
    workspace_root: &Path,
    manifest: &BaselineManifest,
) -> Result<DiffResult> {
    if manifest.git_root.is_none() {
        return Ok(DiffResult {
            details: Vec::new(),
            excluded: manifest.excluded_snapshots.clone(),
        });
    }

    let mut candidates = collect_changed_paths(workspace_root, manifest.head.as_deref())?;
    candidates.extend(manifest.snapshots.keys().cloned());
    candidates.extend(manifest.baseline_absent.iter().cloned());

    let mut details: Vec<HunkDetail> = Vec::new();
    let mut excluded = manifest.excluded_snapshots.clone();
    for relative_path in candidates {
        let absolute_path = resolve_workspace_path(workspace_root, &relative_path)?;
        if let Some(reason) =
            excluded_change_reason(workspace_root, manifest, &relative_path, &absolute_path)
        {
            excluded.push(ExcludedChange {
                path: relative_path,
                reason,
            });
            continue;
        }
        let current = if absolute_path.is_file() {
            match read_text_candidate(&absolute_path) {
                Ok(content) => content,
                Err(reason) => {
                    excluded.push(ExcludedChange {
                        path: relative_path,
                        reason,
                    });
                    continue;
                }
            }
        } else {
            Vec::new()
        };

        let baseline = if let Some(snapshot_name) = manifest.snapshots.get(&relative_path) {
            storage.read_snapshot(workspace_root, &manifest.id, snapshot_name)?
        } else if manifest.baseline_absent.contains(&relative_path) {
            Vec::new()
        } else {
            read_head_file(workspace_root, manifest, &relative_path).unwrap_or_default()
        };

        if baseline == current {
            continue;
        }
        let old = String::from_utf8(baseline).map_err(|_| {
            CodeWalkError::InvalidRequest(format!(
                "baseline file is no longer valid UTF-8: {relative_path}"
            ))
        })?;
        let new = String::from_utf8(current).map_err(|_| {
            CodeWalkError::InvalidRequest(format!(
                "current file is no longer valid UTF-8: {relative_path}"
            ))
        })?;
        details.extend(diff_hunks(&relative_path, &old, &new));
    }

    details.sort_by(|left, right| {
        (&left.hunk.path, left.hunk.start_line, left.hunk.end_line).cmp(&(
            &right.hunk.path,
            right.hunk.start_line,
            right.hunk.end_line,
        ))
    });
    excluded.sort_by(|left, right| left.path.cmp(&right.path));
    excluded.dedup_by(|left, right| left.path == right.path && left.reason == right.reason);
    Ok(DiffResult { details, excluded })
}

pub(crate) fn detect_renamed_destinations(
    workspace_root: &Path,
    head: Option<&str>,
) -> BTreeSet<String> {
    let Some(head) = head else {
        return BTreeSet::new();
    };
    let Ok(output) = git_bytes(
        workspace_root,
        &[
            "diff",
            "--name-status",
            "-z",
            "--find-renames",
            head,
            "--",
            ".",
        ],
    ) else {
        return BTreeSet::new();
    };
    let fields: Vec<&[u8]> = output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect();
    let mut renamed = BTreeSet::new();
    let mut index = 0;
    while index < fields.len() {
        let status = String::from_utf8_lossy(fields[index]);
        index += 1;
        if status.starts_with('R') && index + 1 < fields.len() {
            index += 1;
            renamed.insert(String::from_utf8_lossy(fields[index]).replace('\\', "/"));
            index += 1;
        } else {
            index += 1;
        }
    }
    renamed
}

pub(crate) fn resolve_workspace_path(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<PathBuf> {
    let candidate = Path::new(relative_path);
    if candidate.is_absolute()
        || candidate.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(CodeWalkError::PathOutsideWorkspace(candidate.to_owned()));
    }
    let joined = workspace_root.join(candidate);
    if joined.exists() {
        let canonical_workspace = workspace_root
            .canonicalize()
            .map_err(|error| CodeWalkError::io(workspace_root, error))?;
        let canonical_candidate = joined
            .canonicalize()
            .map_err(|error| CodeWalkError::io(&joined, error))?;
        if !canonical_candidate.starts_with(&canonical_workspace) {
            return Err(CodeWalkError::PathOutsideWorkspace(joined));
        }
    }
    Ok(joined)
}

pub(crate) fn validate_non_empty(field: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(CodeWalkError::InvalidRequest(format!(
            "{field} must not be empty"
        )));
    }
    Ok(())
}

fn collect_changed_paths(workspace_root: &Path, head: Option<&str>) -> Result<BTreeSet<String>> {
    let mut paths = BTreeSet::new();
    if let Some(head) = head {
        let changed = git_bytes(
            workspace_root,
            &["diff", "--name-only", "-z", head, "--", "."],
        )?;
        add_nul_paths(&mut paths, &changed);
    } else {
        let tracked = git_bytes(workspace_root, &["ls-files", "-z", "--", "."])?;
        add_nul_paths(&mut paths, &tracked);
    }
    let untracked = git_bytes(
        workspace_root,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            ".",
        ],
    )?;
    add_nul_paths(&mut paths, &untracked);
    Ok(paths)
}

fn add_nul_paths(paths: &mut BTreeSet<String>, bytes: &[u8]) {
    for raw_path in bytes
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
    {
        paths.insert(String::from_utf8_lossy(raw_path).replace('\\', "/"));
    }
}

fn read_head_file(
    workspace_root: &Path,
    manifest: &BaselineManifest,
    relative_path: &str,
) -> Result<Vec<u8>> {
    let git_root = Path::new(manifest.git_root.as_deref().ok_or_else(|| {
        CodeWalkError::InvalidRequest("baseline does not contain a Git root".to_owned())
    })?);
    let repository_path = repository_path(workspace_root, git_root, relative_path)?;
    let Some(head) = manifest.head.as_deref() else {
        return Ok(Vec::new());
    };
    git_bytes(git_root, &["show", &format!("{head}:{repository_path}")])
}

fn excluded_change_reason(
    workspace_root: &Path,
    manifest: &BaselineManifest,
    relative_path: &str,
    absolute_path: &Path,
) -> Option<String> {
    if is_git_submodule(workspace_root, manifest, relative_path, absolute_path) {
        return Some("Git submodules are listed but not rendered as text changes".to_owned());
    }
    if is_generated_file(workspace_root, relative_path, absolute_path) {
        return Some("generated files are listed but not rendered as code walkthroughs".to_owned());
    }
    None
}

fn is_git_submodule(
    workspace_root: &Path,
    manifest: &BaselineManifest,
    relative_path: &str,
    absolute_path: &Path,
) -> bool {
    if absolute_path.is_dir() {
        return true;
    }
    let (Some(git_root), Some(head)) = (manifest.git_root.as_deref(), manifest.head.as_deref())
    else {
        return false;
    };
    let Ok(repository_path) = repository_path(workspace_root, Path::new(git_root), relative_path)
    else {
        return false;
    };
    git_output(
        Path::new(git_root),
        &["cat-file", "-t", &format!("{head}:{repository_path}")],
    )
    .is_ok_and(|entry_type| entry_type.trim() == "commit")
}

fn is_generated_file(workspace_root: &Path, relative_path: &str, absolute_path: &Path) -> bool {
    let name = Path::new(relative_path)
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or_default();
    if matches!(
        name,
        "Cargo.lock"
            | "package-lock.json"
            | "pnpm-lock.yaml"
            | "yarn.lock"
            | "poetry.lock"
            | "uv.lock"
            | "go.sum"
            | "composer.lock"
    ) {
        return true;
    }
    if let Ok(attribute) = git_output(
        workspace_root,
        &["check-attr", "linguist-generated", "--", relative_path],
    ) {
        let value = attribute.trim().rsplit(": ").next().unwrap_or_default();
        if matches!(value, "set" | "true") {
            return true;
        }
    }
    has_generated_header(absolute_path)
}

fn has_generated_header(path: &Path) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    let mut bytes = Vec::new();
    if file.take(8192).read_to_end(&mut bytes).is_err() {
        return false;
    }
    let header = String::from_utf8_lossy(&bytes).to_lowercase();
    header.contains("@generated")
        || header.contains("automatically generated")
        || (header.contains("code generated") && header.contains("do not edit"))
}

fn repository_path(workspace_root: &Path, git_root: &Path, relative_path: &str) -> Result<String> {
    let canonical_workspace = workspace_root
        .canonicalize()
        .map_err(|error| CodeWalkError::io(workspace_root, error))?;
    let canonical_git_root = git_root
        .canonicalize()
        .map_err(|error| CodeWalkError::io(git_root, error))?;
    let workspace_relative = canonical_workspace
        .strip_prefix(&canonical_git_root)
        .map_err(|_| {
            CodeWalkError::InvalidRequest("workspace is outside the recorded Git root".to_owned())
        })?;
    Ok(workspace_relative
        .join(relative_path)
        .to_string_lossy()
        .replace('\\', "/"))
}

fn read_text_candidate(path: &Path) -> std::result::Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_TEXT_FILE_SIZE {
        return Err(format!(
            "file exceeds the {MAX_TEXT_FILE_SIZE} byte walkthrough limit"
        ));
    }
    let content = fs::read(path).map_err(|error| error.to_string())?;
    if content.contains(&0) {
        return Err("binary file is not rendered as a code walkthrough".to_owned());
    }
    if std::str::from_utf8(&content).is_err() {
        return Err("file is not valid UTF-8".to_owned());
    }
    Ok(content)
}

/// Converts a file pair into current-side hunks, each carrying the baseline text it
/// replaced so that a step can show a "before" excerpt without a second Git call.
fn diff_hunks(path: &str, old: &str, new: &str) -> Vec<HunkDetail> {
    let old = normalize_line_endings(old);
    let new = normalize_line_endings(new);
    let new_line_count = new.lines().count().max(1);
    let old_lines: Vec<&str> = old.lines().collect();
    TextDiff::from_lines(old.as_ref(), new.as_ref())
        .ops()
        .iter()
        .filter_map(|operation| {
            let kind = match operation.tag() {
                DiffTag::Equal => return None,
                DiffTag::Insert => ChangeKind::Add,
                DiffTag::Delete => ChangeKind::Delete,
                DiffTag::Replace => ChangeKind::Modify,
            };
            let new_range = operation.new_range();
            let start_line = u32::try_from((new_range.start + 1).min(new_line_count))
                .expect("text file line count is bounded by the file-size limit");
            let end_line =
                u32::try_from(new_range.end.max(start_line as usize).min(new_line_count))
                    .expect("text file line count is bounded by the file-size limit");
            let old_range = operation.old_range();
            let previous_text = old_lines
                .get(old_range.start..old_range.end.min(old_lines.len()))
                .unwrap_or_default()
                .join("\n");
            Some(HunkDetail {
                hunk: ChangeHunk {
                    path: path.to_owned(),
                    start_line,
                    end_line,
                    kind,
                },
                previous_text,
            })
        })
        .collect()
}

fn normalize_line_endings(text: &str) -> Cow<'_, str> {
    if text.contains('\r') {
        Cow::Owned(text.replace("\r\n", "\n").replace('\r', "\n"))
    } else {
        Cow::Borrowed(text)
    }
}

fn git_output(current_dir: &Path, arguments: &[&str]) -> Result<String> {
    String::from_utf8(git_bytes(current_dir, arguments)?).map_err(Into::into)
}

fn git_bytes(current_dir: &Path, arguments: &[&str]) -> Result<Vec<u8>> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(current_dir)
        .output()
        .map_err(|error| CodeWalkError::io("git", error))?;
    if !output.status.success() {
        return Err(CodeWalkError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    Ok(output.stdout)
}

#[cfg(test)]
mod tests {
    use super::{
        diff_hunks, has_generated_header, is_generated_file, repository_path,
        resolve_workspace_path,
    };
    use crate::model::ChangeKind;
    use std::{fs, path::Path};
    use tempfile::tempdir;

    #[test]
    fn creates_current_side_ranges_for_replacements_and_deletions() {
        let details = diff_hunks("src/lib.rs", "one\ntwo\nthree\n", "one\nchanged\n");
        assert_eq!(details.len(), 1);
        assert_eq!(details[0].hunk.kind, ChangeKind::Modify);
        assert_eq!(
            (details[0].hunk.start_line, details[0].hunk.end_line),
            (2, 2)
        );
    }

    #[test]
    fn keeps_the_replaced_lines_as_the_previous_text() {
        let details = diff_hunks("src/lib.rs", "one\ntwo\nthree\n", "one\nchanged\n");
        assert_eq!(details[0].previous_text, "two\nthree");
    }

    #[test]
    fn normalizes_line_endings_before_calculating_hunks() {
        assert!(diff_hunks("src/lib.rs", "one\r\ntwo\r\n", "one\ntwo\n").is_empty());

        let details = diff_hunks("src/lib.rs", "one\r\ntwo\r\n", "one\nchanged\n");
        assert_eq!(details.len(), 1);
        assert_eq!(details[0].hunk.kind, ChangeKind::Modify);
        assert_eq!(
            (details[0].hunk.start_line, details[0].hunk.end_line),
            (2, 2)
        );
        assert_eq!(details[0].previous_text, "two");
    }

    #[test]
    fn reports_no_previous_text_for_a_pure_insertion() {
        let details = diff_hunks("src/lib.rs", "one\n", "one\ntwo\n");
        assert_eq!(details.len(), 1);
        assert_eq!(details[0].hunk.kind, ChangeKind::Add);
        assert!(details[0].previous_text.is_empty());
    }

    #[test]
    fn reports_an_empty_diff_for_identical_content() {
        assert!(diff_hunks("src/lib.rs", "same\n", "same\n").is_empty());
    }

    #[test]
    fn rejects_parent_path_components() {
        assert!(resolve_workspace_path(Path::new("/workspace"), "../secret").is_err());
    }

    #[test]
    fn canonicalizes_paths_before_calculating_the_repository_relative_path() {
        let repository = tempdir().unwrap();
        fs::create_dir(repository.path().join("nested")).unwrap();
        let lexical_alias = repository.path().join("nested").join("..");

        assert_eq!(
            repository_path(repository.path(), &lexical_alias, "src/lib.rs").unwrap(),
            "src/lib.rs"
        );
    }

    #[test]
    fn recognizes_lockfiles_and_generated_headers() {
        let workspace = tempdir().unwrap();
        let generated = workspace.path().join("generated.rs");
        fs::write(
            &generated,
            "// Code generated by schema compiler. DO NOT EDIT.\npub const VALUE: u8 = 1;\n",
        )
        .unwrap();
        assert!(has_generated_header(&generated));
        assert!(is_generated_file(
            workspace.path(),
            "Cargo.lock",
            &workspace.path().join("Cargo.lock")
        ));
        assert!(is_generated_file(
            workspace.path(),
            "generated.rs",
            &generated
        ));
    }
}
