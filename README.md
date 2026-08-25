# Agent CodeWalk

Agent CodeWalk 让 Codex、Claude Code 和 OpenCode 在完成代码修改后，生成一份可以在 VS Code 或 Cursor 中逐步播放的讲解。每一步会打开对应文件、高亮代码块，并说明修改内容、原因和行为影响。讲解可以按文件顺序或代码执行流播放。

## 使用方式

1. 从 VS Code Marketplace、Open VSX 或 release 中安装 `Agent CodeWalk` 扩展。
2. 运行 `Agent CodeWalk: Setup Agent Integrations`。确认后，扩展会安装本地 MCP companion，并为检测到的 Agent 配置 MCP 和 portable skill；Codex/Claude Code 还会获得任务生命周期提醒。Codex 会要求通过 `/hooks` 检查并信任新安装的用户级 Stop hook。
3. 重启已有 Agent session，然后正常使用 Agent：
   - **让它修改代码** —— 完成后会得到一份讲解本次修改的 walkthrough。
   - **让它分析或讲解代码**（"这个模块怎么工作""跟一遍请求路径""解释一下鉴权流程"）—— 即使一个文件都没改，也会得到一份可以逐步跳转的讲解。
4. Agent 发布讲解时会弹出通知；也可以打开 Activity Bar 中的 Agent CodeWalk，或运行 `Agent CodeWalk: Open Latest Walkthrough`。
5. 逐步查看：

| 操作 | 快捷键 | 命令 |
| --- | --- | --- |
| 下一步 | `Alt+]` | `Agent CodeWalk: Next Step` |
| 上一步 | `Alt+[` | `Agent CodeWalk: Previous Step` |
| 在流程图与文件视图之间切换 | `Alt+\` | `Agent CodeWalk: Switch Between Graph and File Views` |
| 跳转到任意步骤 | `Ctrl+Alt+W`（macOS `Cmd+Alt+W`） | `Agent CodeWalk: Jump to Step` |
| 对比该步骤修改前后 | — | `Agent CodeWalk: Compare Current Step With Before` |

侧边栏顶部是进度和当前步骤的说明，整体说明收在下方的“整体说明”里，点击展开；再往下是步骤列表。默认是流程图：讲解先给出几个高层步骤，每个步骤可以展开，读到下一层的细节；每个步骤各占一行，左侧的连线把它连到依赖它的步骤，点击任意一行即可跳转。也可以切换成按文件分组，一次看到全部步骤。首次展开的层数由 `agentCodeWalk.initialDepth` 控制，默认两层。步骤块中真正发生改动的那几行会按 add / modify / delete 着色，其余部分保持中性，因此不必打开对比也能看清改动。每个被讲解的代码块上方还会出现 CodeLens，可以直接跳转或查看 diff。状态栏显示当前进度，点击可搜索跳转。界面提供英文和简体中文。

用户无需配置额外模型或 API key。说明由刚完成修改的 Agent 生成，代码、baseline 和 walkthrough 只写入本机用户数据目录。

## 两种 walkthrough

| | 修改讲解（change） | 代码讲解（explanation） |
| --- | --- | --- |
| 触发 | Agent 修改了文件 | 要求分析 / 讲解 / review / 跟踪现有代码 |
| 工具 | `begin_task` → `publish_walkthrough` | 直接 `publish_explanation` |
| baseline | 需要，用于计算 diff | 不需要 |
| 覆盖校验 | 每个变更 hunk 都必须被某一步覆盖 | 不适用 |
| 高亮 | 按 add / modify / delete / rename 着色 | 中性色（context） |
| diff | 可对比修改前后 | 无（代码没有变化） |

修改讲解中的某一步也可以指向本次没有改动、但读者需要看到的代码，它会被记为 `context` 并以更安静的方式高亮。

Agent 在给出讲解的同时仍然会在对话里正常回答；walkthrough 是让你对照代码阅读，而不是替代回答。

## 工作原理

Agent 在首次文件 mutation 前调用 `begin_task`。Companion 记录 Git HEAD、当前 index，以及任务开始前已有 dirty/untracked 文件的必要快照。任务完成后，Agent 调用 `publish_walkthrough`；companion 计算本轮变化、验证每个文本 diff hunk 都有讲解步骤、补全稳定 anchor，然后原子发布 session。编辑器扩展读取 session，验证协议和 workspace fingerprint 后才允许打开文件。

Companion 以 Git 仓库根目录作为 workspace 标识，因此 Agent 在子目录中启动时，发布的讲解仍然能被打开了仓库（或其子目录）的编辑器找到。可以用 `AGENT_CODEWALK_WORKSPACE` 覆盖。

Agent 启动时会拿到当时安装的 companion，并在整个会话中一直用它。因此升级扩展不会影响已经在运行的 Agent——它发布的讲解仍然来自旧 companion，看起来就像新功能没生效。每个 session 都会记录发布它的 companion 版本，低于当前扩展版本时侧边栏会直接提示重启 Agent 会话。

如果 Agent 错过了 `begin_task`，仍可降级发布。此时 companion 从当前 Git 状态尽力推导变化，session 会标记 `degradedBaseline`；未被任何步骤覆盖的 hunk 会记录在 `uncoveredHunks` 中并在 UI 中逐条列出，而不是被静默忽略。完整 baseline 下，未覆盖的 hunk 仍然直接拒绝发布。

如果代码在发布后移动，扩展会在同一文件中寻找唯一的代码 hash；没有唯一匹配时会显示 stale，而不会高亮可能错误的位置。

## 隐私和安全

- 默认不发起网络请求，也不调用模型 API。
- MCP companion 只通过 stdio 与本地 Agent 通信，不监听网络端口。
- walkthrough 保存路径、说明、行号和代码块 hash，以及每个步骤所替换的那几行原始文本（用于 before/after 对比，单步上限 4000 字符）。不保存整份源码。
- 路径必须位于发布该 session 的 workspace 根目录内；绝对路径、`..` traversal 和经由 symlink 的逃逸都会被拒绝。
- 一键安装在写用户配置前显示目标路径并创建备份；安装失败会自动回滚本轮文件变更，遇到非本工具拥有的同名 skill 或 MCP 条目时拒绝覆盖。
- 卸载只删除 ownership manifest 标记的 skill/adapter，以及 command 仍指向已安装 companion 的配置项。walkthrough session 默认保留。
- `Agent CodeWalk: Diagnose Installation` 会直接询问各个 Agent 实际加载了哪些 MCP server，而不只是检查配置文件是否存在。

## 当前限制

- v1 面向桌面 VS Code/Cursor、Remote SSH 和 WSL；浏览器版无法启动本地 companion。
- 二进制、生成文件、Git submodule、超过 1 MiB 的文件和非 UTF-8 文件不会进入文本 diff 分析，但会在 `excludedChanges` 中列出原因。
- 非 Git workspace 可以降级发布，但 UI 会提示 baseline 范围可能不完整。
- 整个文件被删除时没有当前代码可高亮，步骤会保留说明并显示 target unavailable。
- 纯新增的代码块没有"修改前"可对比，该步骤不会提供 diff；代码讲解同理。
- 代码讲解的每一步都必须指向当前存在的代码，否则发布会被拒绝。
- 集成只写用户级配置；project 级安装尚未提供，见 `docs/roadmap.md`。

## 开发

要求 Node.js 20+、pnpm 10、Rust 1.85+ 和 Git。

```bash
corepack pnpm install
corepack pnpm check
corepack pnpm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
corepack pnpm --filter agent-codewalk test:extension   # 需要显示环境（CI 使用 xvfb）
corepack pnpm --filter agent-codewalk package
node scripts/verify-agent-install.mjs                  # 确认各 Agent 真的加载了 companion
```

协议定义位于 `protocol/walkthrough-v1.schema.json`，正反例 fixture 位于 `protocol/fixtures/`，由 Rust 与 TypeScript 两侧共同断言。Rust companion 在 `crates/agent-codewalk-mcp`，编辑器扩展、portable skill 和本地化文案在 `extension`。到 v1.0 的计划见 `docs/roadmap.md`。
