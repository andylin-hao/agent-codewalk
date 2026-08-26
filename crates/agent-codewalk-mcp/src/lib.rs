//! Local MCP companion and storage engine for Agent `CodeWalk`.

pub mod baseline;
pub mod error;
pub mod mcp;
pub mod model;
pub mod service;
pub mod settings;
pub mod storage;

pub use error::{CodeWalkError, Result};
pub use service::CodeWalkService;
