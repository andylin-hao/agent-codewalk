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
