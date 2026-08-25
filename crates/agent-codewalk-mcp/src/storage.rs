use std::{
    fs,
    path::{Path, PathBuf},
};

use directories::BaseDirs;
use serde::{Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{CodeWalkError, Result, model::BaselineManifest};

const HOME_ENVIRONMENT_VARIABLE: &str = "AGENT_CODEWALK_HOME";

/// Owns all local Agent `CodeWalk` state.
#[derive(Clone, Debug)]
pub struct Storage {
    root: PathBuf,
}

impl Storage {
    /// Resolves the configured or platform-local state directory.
    ///
    /// # Errors
    ///
    /// Returns an error if a data directory is unavailable or cannot be created.
    pub fn from_environment() -> Result<Self> {
        if let Some(root) = std::env::var_os(HOME_ENVIRONMENT_VARIABLE) {
            return Self::new(PathBuf::from(root));
        }
        let base_dirs = BaseDirs::new().ok_or(CodeWalkError::MissingDataDirectory)?;
        Self::new(base_dirs.data_local_dir().join("agent-codewalk"))
    }

    /// Creates storage at an explicit path.
    ///
    /// # Errors
    ///
    /// Returns an error when the directory cannot be created.
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(|error| CodeWalkError::io(&root, error))?;
        Ok(Self { root })
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    #[must_use]
    pub fn workspace_fingerprint(workspace_root: &Path) -> String {
        let normalized = workspace_root.to_string_lossy().replace('\\', "/");
        hex::encode(Sha256::digest(normalized.as_bytes()))
    }

    pub(crate) fn task_dir(&self, workspace_root: &Path, task_id: &str) -> PathBuf {
        self.workspace_dir(workspace_root)
            .join("tasks")
            .join(task_id)
    }

    pub(crate) fn create_task_dir(&self, workspace_root: &Path, task_id: &str) -> Result<PathBuf> {
        let task_dir = self.task_dir(workspace_root, task_id);
        fs::create_dir_all(task_dir.join("snapshots"))
            .map_err(|error| CodeWalkError::io(&task_dir, error))?;
        Ok(task_dir)
    }

    pub(crate) fn write_manifest(
        &self,
        workspace_root: &Path,
        manifest: &BaselineManifest,
    ) -> Result<()> {
        let path = self
            .task_dir(workspace_root, &manifest.id)
            .join("manifest.json");
        Self::write_json_atomic(&path, manifest)
    }

    pub(crate) fn read_manifest(
        &self,
        workspace_root: &Path,
        task_id: &str,
    ) -> Result<BaselineManifest> {
        let path = self.task_dir(workspace_root, task_id).join("manifest.json");
        if !path.is_file() {
            return Err(CodeWalkError::TaskNotFound(task_id.to_owned()));
        }
        Self::read_json(&path)
    }

    pub(crate) fn write_snapshot(
        &self,
        workspace_root: &Path,
        task_id: &str,
        relative_path: &str,
        content: &[u8],
    ) -> Result<String> {
        let name = format!(
            "{}.snapshot",
            hex::encode(Sha256::digest(relative_path.as_bytes()))
        );
        let path = self
            .task_dir(workspace_root, task_id)
            .join("snapshots")
            .join(&name);
        fs::write(&path, content).map_err(|error| CodeWalkError::io(&path, error))?;
        Ok(name)
    }

    pub(crate) fn read_snapshot(
        &self,
        workspace_root: &Path,
        task_id: &str,
        name: &str,
    ) -> Result<Vec<u8>> {
        let path = self
            .task_dir(workspace_root, task_id)
            .join("snapshots")
            .join(name);
        fs::read(&path).map_err(|error| CodeWalkError::io(path, error))
    }

    pub(crate) fn delete_task(&self, workspace_root: &Path, task_id: &str) -> Result<()> {
        let task_dir = self.task_dir(workspace_root, task_id);
        if task_dir.exists() {
            fs::remove_dir_all(&task_dir).map_err(|error| CodeWalkError::io(&task_dir, error))?;
        }
        Ok(())
    }

    pub(crate) fn task_exists(&self, workspace_root: &Path, task_id: &str) -> bool {
        self.task_dir(workspace_root, task_id)
            .join("manifest.json")
            .is_file()
    }

    pub(crate) fn pending_task_count(&self, workspace_root: &Path) -> Result<usize> {
        let tasks = self.workspace_dir(workspace_root).join("tasks");
        let entries = match fs::read_dir(&tasks) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(error) => return Err(CodeWalkError::io(&tasks, error)),
        };
        let mut count = 0;
        for entry in entries {
            let entry = entry.map_err(|error| CodeWalkError::io(&tasks, error))?;
            if entry.path().join("manifest.json").is_file() {
                count += 1;
            }
        }
        Ok(count)
    }

    pub(crate) fn write_session<T: Serialize>(
        &self,
        workspace_root: &Path,
        session_id: &str,
        value: &T,
    ) -> Result<PathBuf> {
        let sessions = self.workspace_dir(workspace_root).join("sessions");
        fs::create_dir_all(&sessions).map_err(|error| CodeWalkError::io(&sessions, error))?;
        let path = sessions.join(format!("{session_id}.json"));
        Self::write_json_atomic(&path, value)?;
        Ok(path)
    }

    fn workspace_dir(&self, workspace_root: &Path) -> PathBuf {
        self.root
            .join("workspaces")
            .join(Self::workspace_fingerprint(workspace_root))
    }

    fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T> {
        let content = fs::read(path).map_err(|error| CodeWalkError::io(path, error))?;
        Ok(serde_json::from_slice(&content)?)
    }

    fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
        let parent = path.parent().ok_or_else(|| {
            CodeWalkError::InvalidRequest(format!("path has no parent: {}", path.display()))
        })?;
        fs::create_dir_all(parent).map_err(|error| CodeWalkError::io(parent, error))?;
        let temporary = parent.join(format!(".{}.tmp", Uuid::new_v4()));
        let content = serde_json::to_vec_pretty(value)?;
        fs::write(&temporary, content).map_err(|error| CodeWalkError::io(&temporary, error))?;
        fs::rename(&temporary, path).map_err(|error| CodeWalkError::io(path, error))
    }
}

#[cfg(test)]
mod tests {
    use super::Storage;
    use crate::model::{AgentKind, BaselineManifest};
    use std::{collections::BTreeMap, fs, path::Path};
    use tempfile::tempdir;

    fn manifest(id: &str, workspace_root: &Path) -> BaselineManifest {
        BaselineManifest {
            id: id.to_owned(),
            workspace_root: workspace_root.to_string_lossy().into_owned(),
            git_root: None,
            head: None,
            goal: "goal".to_owned(),
            title: None,
            agent: AgentKind::Other,
            session_id: None,
            started_at: "2026-01-01T00:00:00Z".to_owned(),
            degraded_baseline: false,
            snapshots: BTreeMap::new(),
            baseline_absent: Vec::new(),
            excluded_snapshots: Vec::new(),
        }
    }

    #[test]
    fn separates_workspaces_by_fingerprint() {
        let first = Storage::workspace_fingerprint(Path::new("/a/project"));
        let second = Storage::workspace_fingerprint(Path::new("/b/project"));
        assert_ne!(first, second);
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
    }

    #[test]
    fn normalizes_windows_separators_in_the_fingerprint() {
        assert_eq!(
            Storage::workspace_fingerprint(Path::new("C:/code/project")),
            Storage::workspace_fingerprint(Path::new("C:\\code\\project"))
        );
    }

    #[test]
    fn round_trips_a_manifest() {
        let state = tempdir().unwrap();
        let workspace = tempdir().unwrap();
        let storage = Storage::new(state.path().to_owned()).unwrap();
        storage.create_task_dir(workspace.path(), "task").unwrap();
        storage
            .write_manifest(workspace.path(), &manifest("task", workspace.path()))
            .unwrap();
        let loaded = storage.read_manifest(workspace.path(), "task").unwrap();
        assert_eq!(loaded.id, "task");
        assert!(storage.task_exists(workspace.path(), "task"));
    }

    #[test]
    fn reports_a_missing_task_instead_of_an_io_error() {
        let state = tempdir().unwrap();
        let workspace = tempdir().unwrap();
        let storage = Storage::new(state.path().to_owned()).unwrap();
        let error = storage
            .read_manifest(workspace.path(), "absent")
            .unwrap_err();
        assert!(error.to_string().contains("absent"));
        assert!(!storage.task_exists(workspace.path(), "absent"));
    }

    #[test]
    fn deleting_a_task_is_idempotent() {
        let state = tempdir().unwrap();
        let workspace = tempdir().unwrap();
        let storage = Storage::new(state.path().to_owned()).unwrap();
        storage.create_task_dir(workspace.path(), "task").unwrap();
        storage.delete_task(workspace.path(), "task").unwrap();
        storage.delete_task(workspace.path(), "task").unwrap();
        assert!(!storage.task_exists(workspace.path(), "task"));
    }

    #[test]
    fn counts_only_tasks_with_a_manifest() {
        let state = tempdir().unwrap();
        let workspace = tempdir().unwrap();
        let storage = Storage::new(state.path().to_owned()).unwrap();
        assert_eq!(storage.pending_task_count(workspace.path()).unwrap(), 0);
        storage
            .create_task_dir(workspace.path(), "partial")
            .unwrap();
        assert_eq!(storage.pending_task_count(workspace.path()).unwrap(), 0);
        storage.create_task_dir(workspace.path(), "task").unwrap();
        storage
            .write_manifest(workspace.path(), &manifest("task", workspace.path()))
            .unwrap();
        assert_eq!(storage.pending_task_count(workspace.path()).unwrap(), 1);
    }

    #[test]
    fn stores_snapshots_under_a_path_derived_name() {
        let state = tempdir().unwrap();
        let workspace = tempdir().unwrap();
        let storage = Storage::new(state.path().to_owned()).unwrap();
        storage.create_task_dir(workspace.path(), "task").unwrap();
        let name = storage
            .write_snapshot(workspace.path(), "task", "src/lib.rs", b"before\n")
            .unwrap();
        let same = storage
            .write_snapshot(workspace.path(), "task", "src/lib.rs", b"before\n")
            .unwrap();
        assert_eq!(name, same, "the same path must map to the same snapshot");
        assert_eq!(
            storage
                .read_snapshot(workspace.path(), "task", &name)
                .unwrap(),
            b"before\n"
        );
    }

    #[test]
    fn writes_sessions_atomically_without_leaving_temporary_files() {
        let state = tempdir().unwrap();
        let workspace = tempdir().unwrap();
        let storage = Storage::new(state.path().to_owned()).unwrap();
        let path = storage
            .write_session(
                workspace.path(),
                "session",
                &serde_json::json!({ "id": "session" }),
            )
            .unwrap();
        assert!(path.is_file());
        let directory = path.parent().unwrap();
        let leftovers: Vec<_> = fs::read_dir(directory)
            .unwrap()
            .filter_map(std::result::Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with('.'))
            .collect();
        assert!(leftovers.is_empty(), "temporary files must be renamed away");
    }

    #[test]
    fn overwrites_a_session_in_place() {
        let state = tempdir().unwrap();
        let workspace = tempdir().unwrap();
        let storage = Storage::new(state.path().to_owned()).unwrap();
        storage
            .write_session(
                workspace.path(),
                "session",
                &serde_json::json!({ "value": 1 }),
            )
            .unwrap();
        let path = storage
            .write_session(
                workspace.path(),
                "session",
                &serde_json::json!({ "value": 2 }),
            )
            .unwrap();
        let content = fs::read_to_string(path).unwrap();
        assert!(content.contains("\"value\": 2"));
    }

    #[test]
    fn creates_the_state_directory_on_demand() {
        let parent = tempdir().unwrap();
        let root = parent.path().join("nested").join("state");
        let storage = Storage::new(root.clone()).unwrap();
        assert_eq!(storage.root(), root);
        assert!(root.is_dir());
    }
}
