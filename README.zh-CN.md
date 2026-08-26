<p align="center">
  <img src="extension/media/icon.png" width="112" alt="Agent CodeWalk 图标">
</p>

<h1 align="center">Agent CodeWalk</h1>

<p align="center">
  把 Agent 的改动，变成可以在编辑器里逐步阅读的代码讲解。
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=agent-codewalk.agent-codewalk"><img alt="Visual Studio Marketplace 版本" src="https://img.shields.io/visual-studio-marketplace/v/agent-codewalk.agent-codewalk?style=flat-square&label=VS%20Marketplace"></a>
  <a href="https://open-vsx.org/extension/agent-codewalk/agent-codewalk"><img alt="Open VSX 版本" src="https://img.shields.io/open-vsx/v/agent-codewalk/agent-codewalk?style=flat-square&label=Open%20VSX"></a>
  <a href="https://github.com/andylin-hao/agent-codewalk/releases/latest"><img alt="最新 GitHub Release" src="https://img.shields.io/github/v/release/andylin-hao/agent-codewalk?style=flat-square"></a>
  <a href="https://github.com/andylin-hao/agent-codewalk/actions/workflows/ci.yml"><img alt="构建状态" src="https://img.shields.io/github/actions/workflow/status/andylin-hao/agent-codewalk/ci.yml?branch=main&style=flat-square&label=build"></a>
  <a href="LICENSE"><img alt="MIT 许可证" src="https://img.shields.io/badge/license-MIT-5c6ac4?style=flat-square"></a>
</p>

![Agent CodeWalk 界面预览](extension/media/hero.png)

AI 编程 Agent 往往很快就能完成任务，但交付结果通常只有一段摘要。改了哪些文件、关键逻辑在哪里、调用关系怎么走，还是要靠你自己翻代码。

Agent CodeWalk 把讲解带回代码现场。任务完成后，它会在 VS Code 或 Cursor 中依次打开相关文件，高亮对应代码，并说明这段代码做了什么、为什么这样改、接下来该看哪里。你看到的不再是一串零散的文件名，而是一条可以跟着走的阅读路径。

它不需要额外配置模型，也不需要 API Key。讲解由你已经在使用的 Codex、Claude Code 或 OpenCode 生成；扩展和本地 MCP 配套程序负责记录改动、校验覆盖范围，并在编辑器中展示结果。

## 它适合解决什么问题

- **刚让 Agent 完成了一项改动，想快速验收。** 直接按步骤查看关键实现、测试和调用方，不必在聊天记录与文件列表之间来回切换。
- **接手陌生代码，想先理清主线。** 让 Agent 围绕一个问题生成代码走读，例如“请求从入口到数据库经历了什么”。
- **审查重构或修复是否完整。** 讲解改动时，CodeWalk 会检查本轮每一处文本差异；如果还有改动没有讲到，就无法直接发布。
- **想知道某段说明到底对应哪几行代码。** 每一步都指向具体文件和行号；点击后会打开源文件并高亮对应代码块。
- **不希望为代码讲解再接入一套云服务。** 会话、基线和讲解都保存在本机，没有遥测，也不会调用额外的模型接口。

一份代码走读（walkthrough）既可以按依赖关系展示，也可以按文件浏览。代码在任务结束后发生移动时，扩展会尝试重新定位；无法确认唯一位置就会明确标记为过期，不会随意高亮一段可能无关的代码。

## 安装扩展

建议优先从扩展市场安装，后续更新会更省心。

### VS Code 与 Cursor

在扩展面板中搜索 **Agent CodeWalk**，或打开 [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=agent-codewalk.agent-codewalk)。也可以在终端执行：

```bash
code --install-extension agent-codewalk.agent-codewalk
```

Cursor 用户可以直接从扩展面板安装，也可以使用命令行：

```bash
cursor --install-extension agent-codewalk.agent-codewalk
```

### VSCodium 与 Open VSX

使用 Open VSX 的编辑器可以从 [Open VSX Registry](https://open-vsx.org/extension/agent-codewalk/agent-codewalk) 安装，或运行：

```bash
codium --install-extension agent-codewalk.agent-codewalk
```

### 从 GitHub 下载 VSIX

[GitHub Releases](https://github.com/andylin-hao/agent-codewalk/releases) 会为每个正式版本提供不同平台的 VSIX，并附带 `SHA256SUMS` 校验文件。请选择扩展实际运行环境对应的安装包；使用 Remote SSH 时，通常应选择远端主机的平台。

| 运行环境 | VSIX 文件 |
| --- | --- |
| Linux x64（包括大多数 Remote SSH 主机） | `agent-codewalk-linux-x64.vsix` |
| Windows x64 | `agent-codewalk-win32-x64.vsix` |
| macOS Intel | `agent-codewalk-darwin-x64.vsix` |
| macOS Apple 芯片 | `agent-codewalk-darwin-arm64.vsix` |

下载后，在命令面板中运行 **Extensions: Install from VSIX...**，也可以通过终端安装：

```bash
code --install-extension ./agent-codewalk-linux-x64.vsix
```

VSIX 适合离线安装或固定版本，但不会走扩展市场的常规自动更新。日常使用仍建议通过 Marketplace 或 Open VSX 安装。

## 第一次使用：接入你的 Agent

编辑器扩展负责展示走读内容。要让 Codex、Claude Code 或 OpenCode 在任务结束后自动发布讲解，还需要完成一次本地接入：

1. 打开命令面板，运行 **Agent CodeWalk: Setup Agent Integrations**。
2. 先查看确认窗口。这里会列出配套程序的安装位置，以及准备修改的配置、skill 和 hook 文件。
3. 确认无误后选择 **Install**。安装器会先创建备份；如果中途失败，会回滚本次未完成的配置。
4. 重启已经打开的 Agent 会话，让新配置生效。
5. 运行 **Agent CodeWalk: Diagnose Installation**，确认各个 Agent 实际加载了正确的 MCP 服务。

安装器只会处理当前检测到的 Agent。以后新装了其他 Agent，再执行一次 Setup 即可。它不会覆盖来源不明的同名配置；具体的写入范围和恢复方式见[故障排查](docs/troubleshooting.md)。

## 平时怎么用

无需专门为 CodeWalk 编写提示词，像往常一样把任务交给 Agent 即可。

### 看懂刚完成的改动

例如：

```text
给文件上传增加失败重试，并补齐超时场景的测试。
重构鉴权中间件，把请求处理流程理顺。
修复这个问题，同时更新 CLI 帮助和用户文档。
```

第一次改动文件前，Agent 会记录本轮任务的基线；完成实现和验证后，再发布覆盖全部文本改动的代码走读。步骤中也可以包含没有变化但理解本次修改所必需的代码，例如接口定义、调用方或共享约束。这类内容会使用中性的上下文样式，不会被误认为本轮改动。

### 走读已有代码

如果你只想理解代码，不需要先制造一次改动。可以直接问：

```text
带我看一遍代码走读从发布到显示在侧边栏的完整流程。
解释安装器如何判断哪些配置可以安全删除。
检查过期定位点的处理逻辑，重点说明定位失败时如何避免跳错代码。
```

这种请求会生成只读走读，只引用当前代码，不记录修改基线，也不会为了讲解而改动文件。一般性的咨询如果没有对应代码，Agent 会直接在对话里回答，不会生成多余的走读。

## 在编辑器里阅读

Agent 发布完成后，可以直接点击通知，也可以点击活动栏里的 Agent CodeWalk 图标，或运行 **Agent CodeWalk: Open Latest Walkthrough**。图标就在你常用的 Agent 与版本控制工具旁边，也就是大多数人会去找扩展的地方。

VS Code 把容器的图标固定在容器所在的位置，因此活动栏图标打开的是左侧主侧边栏。如果你更习惯把讲解放在代码旁边阅读，把图标拖进右侧辅助侧边栏即可，VS Code 会记住这次调整，**View: Reset View Locations** 可以撤销。

| 操作 | 快捷键 | 命令 |
| --- | --- | --- |
| 下一步 | `Alt+]` | **Agent CodeWalk: Next Step** |
| 上一步 | `Alt+[` | **Agent CodeWalk: Previous Step** |
| 切换流程图与文件视图 | `Alt+\` | **Agent CodeWalk: Switch Between Graph and File Views** |
| 跳转到任意步骤 | `Ctrl+Alt+W`（macOS 为 `Cmd+Alt+W`） | **Agent CodeWalk: Jump to Step** |
| 对比修改前后的代码 | — | **Agent CodeWalk: Compare Current Step With Before** |

流程图适合沿着依赖关系理解一条执行路径：先看入口，再逐步展开细节。文件视图则更适合逐个检查本轮涉及的文件。无论从侧边栏、CodeLens、状态栏还是搜索结果进入，都会定位到同一个代码步骤。

界面会跟随编辑器语言，目前支持英文和简体中文。

## 数据保存与隐私

Agent CodeWalk 采用本地优先（local-first）设计：

- 不收集遥测数据，不主动发起网络请求，也不调用模型 API。
- Rust 配套程序只通过标准输入输出与 Agent 通信，不监听网络端口。
- 会话保存在本机，记录文件路径、说明、行号、代码哈希，以及每一步最多 4,000 个字符的旧文本用于前后对比；不会复制整份源文件。
- 工作区之外的路径、绝对路径和通过符号链接越界的路径会在发布时被拒绝。
- 只有编辑器通过 Marketplace、Open VSX 或 GitHub 安装和更新扩展时，才会访问相应的分发服务。

完整的信任边界、数据流和漏洞报告方式见[架构说明](docs/architecture.md)与[安全策略](SECURITY.md)。

## 兼容性与限制

- 需要桌面版 VS Code 1.106 或更高版本。Cursor、VSCodium、Remote SSH 和 WSL 需要提供兼容的桌面扩展宿主。
- 浏览器版编辑器无法启动本地配套程序。
- 二进制文件、Git 子模块、生成文件、非 UTF-8 文件和超过 1 MiB 的文件不会生成代码步骤，但会列在排除项中。
- 整个文件被删除后，已经没有当前代码可供高亮；说明会保留，并明确显示目标不可用。
- 非 Git 工作区也能使用，但改动范围只能尽力推断，界面会提示结果可能不完整。
- Agent 接入目前使用用户级配置，暂不提供项目级安装。

遇到安装、发现、会话过期或代码定位问题，请查看[故障排查](docs/troubleshooting.md)。

## 可选设置

默认配置适合大多数用户。如需调整，可在编辑器设置中搜索 `Agent CodeWalk`。

| 设置 | 默认值 | 作用 |
| --- | --- | --- |
| `agentCodeWalk.initialDepth` | `2` | 第一次打开时，流程图默认展开的层数 |
| `agentCodeWalk.notifyOnPublish` | `true` | 收到新的代码走读时是否显示通知 |
| `agentCodeWalk.refreshInterval` | `4000` | 文件监听不可用时的轮询间隔，单位为毫秒 |
| `agentCodeWalk.storagePath` | 当前平台的数据目录 | 自定义会话和配套程序的保存位置 |
| `agentCodeWalk.companionPath` | 扩展内置二进制 | 开发或排查问题时，改用自行构建的配套程序 |

环境变量 `AGENT_CODEWALK_HOME` 可以覆盖数据目录，`AGENT_CODEWALK_WORKSPACE` 可以覆盖配套程序使用的工作区根目录。

## 开发与项目资料

- [贡献指南](CONTRIBUTING.md)：开发环境、测试要求与 pull request 流程
- [架构说明](docs/architecture.md)：组件关系、存储方式、信任边界与数据流
- [故障排查](docs/troubleshooting.md)：常见安装和使用问题
- [支持说明](SUPPORT.md)：提问方式和问题报告模板
- [安全策略](SECURITY.md)：支持版本与漏洞报告流程
- [发布指南](docs/publishing.md)：Marketplace、Open VSX 与 GitHub Releases
- [路线图](docs/roadmap.md)：1.0 之前的重点工作
- [更新日志](extension/CHANGELOG.md)：各版本面向用户的变化
- [Agent 协作规范](AGENTS.md)：Coding Agent 在本仓库中需要遵守的约定

项目使用 TypeScript 和 Rust 编写，并启用了严格的类型与静态检查。准备贡献代码前，请先阅读[贡献指南](CONTRIBUTING.md)，尤其是跨 TypeScript/Rust 协议变更与完整验证流程的要求。欢迎提交信息充分的缺陷报告和范围清晰的 pull request。

## 许可证

Agent CodeWalk 基于 [MIT License](LICENSE) 开源。
