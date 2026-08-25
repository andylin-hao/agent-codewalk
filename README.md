# Agent CodeWalk

Agent CodeWalk 让 Codex、Claude Code 和 OpenCode 在完成代码修改后，生成一份可以在 VS Code 或 Cursor 中逐步播放的讲解。每一步会打开对应文件、高亮代码块，并说明修改内容、原因和行为影响。讲解可以按文件顺序或代码执行流播放。

## 使用方式

1. 从 VS Code Marketplace、Open VSX 或 release 中安装 `Agent CodeWalk` 扩展。
2. 运行 `Agent CodeWalk: Setup Agent Integrations`。确认后，扩展会安装本地 MCP companion，并为检测到的 Agent 配置 MCP 和 portable skill；Codex/Claude Code 还会获得任务生命周期提醒。Codex 会要求通过 `/hooks` 检查并信任新安装的用户级 Stop hook。
3. 重启已有 Agent session，然后正常要求 Agent 修改代码。
4. 修改和验证完成后，打开 Activity Bar 中的 Agent CodeWalk，或运行 `Agent CodeWalk: Open Latest Walkthrough`。
5. 使用 Previous/Next 逐步查看，通过 Order 按钮切换文件顺序和执行流顺序。

用户无需配置额外模型或 API key。说明由刚完成修改的 Agent 生成，代码、baseline 和 walkthrough 只写入本机用户数据目录。

## 工作原理

Agent 在首次文件 mutation 前调用 `begin_task`。Companion 记录 Git HEAD、当前 index，以及任务开始前已有 dirty/untracked 文件的必要快照。任务完成后，Agent 调用 `publish_walkthrough`；companion 计算本轮变化、验证每个文本 diff hunk 都有讲解步骤、补全稳定 anchor，然后原子发布 session。编辑器扩展读取 session，验证协议和 workspace fingerprint 后才允许打开文件。

如果 Agent 错过了 `begin_task`，仍可降级发布。此时 companion 从当前 Git 状态尽力推导变化，session 会标记 `degradedBaseline`，扩展会持续提示范围可能包含任务开始前的修改。

如果代码在发布后移动，扩展会在同一文件中寻找唯一的代码 hash；没有唯一匹配时会显示 stale，而不会高亮可能错误的位置。

## 隐私和安全

- 默认不发起网络请求，也不调用模型 API。
- MCP companion 只通过 stdio 与本地 Agent 通信，不监听网络端口。
- walkthrough 只保存路径、说明、行号和代码块 hash，不保存整份源码。
- 路径必须位于当前 workspace；绝对路径和 `..` traversal 会被拒绝。
- 一键安装在写用户配置前显示目标路径并创建备份；安装失败会自动回滚本轮文件变更，遇到非本工具拥有的同名 skill 或 MCP 条目时拒绝覆盖。
- 卸载只删除 ownership manifest 标记的 skill/adapter，以及 command 仍指向已安装 companion 的配置项。walkthrough session 默认保留。

## 当前限制

- v1 面向桌面 VS Code/Cursor、Remote SSH 和 WSL；浏览器版无法启动本地 companion。
- 二进制、生成文件、Git submodule、超过 1 MiB 的文件和非 UTF-8 文件不会进入文本 diff 分析，但会在 `excludedChanges` 中列出原因。
- 非 Git workspace 可以降级发布，但 UI 会提示 baseline 范围可能不完整。
- 整个文件被删除时没有当前代码可高亮，步骤会保留说明并显示 target unavailable。

## 开发

要求 Node.js 20+、pnpm 10、Rust 1.85+ 和 Git。

```bash
corepack pnpm install
cargo test --workspace
corepack pnpm --filter agent-codewalk test
corepack pnpm --filter agent-codewalk check
cargo clippy --workspace --all-targets -- -D warnings
cargo build --release
corepack pnpm --filter agent-codewalk package
```

协议定义位于 `protocol/walkthrough-v1.schema.json`。Rust companion 在 `crates/agent-codewalk-mcp`，编辑器扩展和 portable skill 在 `extension`。
