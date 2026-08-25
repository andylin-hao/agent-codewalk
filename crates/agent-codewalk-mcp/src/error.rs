use std::{io, path::PathBuf, string::FromUtf8Error};

/// Errors returned by the Agent `CodeWalk` companion.
#[derive(Debug, thiserror::Error)]
pub enum CodeWalkError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("path is outside the workspace: {0}")]
    PathOutsideWorkspace(PathBuf),
    #[error("task was not found: {0}")]
    TaskNotFound(String),
    #[error("walkthrough does not cover all changed hunks: {0}")]
    IncompleteCoverage(String),
    #[error("Git command failed: {0}")]
    Git(String),
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("invalid UTF-8 returned by a child process: {0}")]
    Utf8(#[from] FromUtf8Error),
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("a platform data directory is unavailable")]
    MissingDataDirectory,
}

impl CodeWalkError {
    pub(crate) fn io(path: impl Into<PathBuf>, source: io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }
}

pub type Result<T> = std::result::Result<T, CodeWalkError>;
