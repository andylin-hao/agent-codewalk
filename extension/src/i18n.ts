import type { ChangeKind } from "./types.js";

// User-visible strings for the walkthrough view.
//
// VS Code localizes the manifest through package.nls files, but a webview renders its
// own markup, so the sidebar needs its own table. Keys are grouped by where they appear.

export interface Messages {
  readonly emptyTitle: string;
  readonly emptyLead: string;
  readonly emptySteps: readonly string[];
  readonly setupPrimary: string;
  readonly reload: string;
  readonly progressLabel: string;
  readonly previous: string;
  readonly next: string;
  readonly orderByFile: string;
  readonly orderByGraph: string;
  readonly graphLead: string;
  readonly keyboardHint: string;
  readonly overview: string;
  readonly compare: string;
  readonly allSteps: string;
  readonly sessionLabel: string;
  readonly integrations: string;
  readonly delete: string;
  readonly stepCounter: string;
  readonly stepUnit: string;
  readonly runsAfter: string;
  readonly staleNotice: string;
  readonly relocatedNotice: string;
  readonly degradedNotice: string;
  readonly staleCompanionNotice: string;
  readonly uncoveredNotice: string;
  readonly excludedNotice: string;
  readonly publishedNotice: string;
  readonly explanationPublishedNotice: string;
  readonly openWalkthrough: string;
  readonly noWalkthrough: string;
  readonly explanationLabel: string;
  readonly changeLabel: string;
  /** Badge text for a step, by what its highlight means. */
  readonly kinds: Readonly<Record<ChangeKind, string>>;
}

const english: Messages = {
  emptyTitle: "No walkthrough yet",
  emptyLead:
    "Agent CodeWalk plays back the changes an agent just made, one highlighted block at a time.",
  emptySteps: [
    "Run <strong>Setup Agent Integrations</strong> once.",
    "Restart your agent session so it loads the tools.",
    "Ask Codex, Claude Code, or OpenCode to change code as usual.",
    "Come back here when it reports that it is done.",
  ],
  setupPrimary: "Set up agent integrations",
  reload: "Reload published walkthroughs",
  progressLabel: "Progress",
  previous: "Previous",
  next: "Next",
  orderByFile: "By file",
  orderByGraph: "Graph",
  graphLead: "Click a step with a triangle to read its detail, and click it again to fold it away. The lines on the left join a step to what depends on it.",
  keyboardHint: "Alt+] reads on, opening a step to show its detail. Alt+\\ switches the view.",
  overview: "Walkthrough overview",
  compare: "Compare with before",
  allSteps: "All steps",
  sessionLabel: "Walkthrough",
  integrations: "Integrations",
  delete: "Delete",
  stepCounter: "Step {0} of {1}",
  stepUnit: "steps",
  runsAfter: "Runs after: ",
  staleNotice: "This block moved or changed since publication, so nothing is highlighted.",
  relocatedNotice: "The block moved. Agent CodeWalk found exactly one match and highlighted it.",
  degradedNotice:
    "Published without a complete baseline, so the scope may include earlier changes.",
  staleCompanionNotice:
    "Published by companion {0}, but {1} is installed. Restart your agent session so it picks up the new companion; until then its walkthroughs will lack the newer features.",
  uncoveredNotice: "Changes with no explanation:",
  excludedNotice: "Changed but not shown as code:",
  publishedNotice: "Agent CodeWalk: “{0}” is ready with {1} step(s).",
  explanationPublishedNotice: "Agent CodeWalk: an explanation of “{0}” is ready with {1} step(s).",
  openWalkthrough: "Open walkthrough",
  noWalkthrough: "There is no active Agent CodeWalk walkthrough.",
  explanationLabel: "Explanation",
  changeLabel: "Change",
  kinds: {
    add: "added",
    modify: "modified",
    delete: "deleted",
    rename: "renamed",
    context: "context",
  },
};

const simplifiedChinese: Messages = {
  emptyTitle: "暂无讲解",
  emptyLead: "Agent CodeWalk 会回放 Agent 刚刚完成的修改，每次高亮一个代码块。",
  emptySteps: [
    "运行一次 <strong>Setup Agent Integrations</strong>。",
    "重启 Agent 会话，让它加载这些工具。",
    "像平常一样让 Codex、Claude Code 或 OpenCode 修改代码。",
    "它报告完成后回到这里。",
  ],
  setupPrimary: "配置 Agent 集成",
  reload: "重新加载已发布的讲解",
  progressLabel: "进度",
  previous: "上一步",
  next: "下一步",
  orderByFile: "按文件",
  orderByGraph: "流程图",
  graphLead: "点击带三角的步骤即可阅读其下更细的步骤，再点一次收起；左侧的连线把一个步骤连到依赖它的步骤。",
  keyboardHint: "Alt+] 继续往下读，遇到可展开的步骤会自动展开；Alt+\\ 可切换视图。",
  overview: "整体说明",
  compare: "与修改前对比",
  allSteps: "全部步骤",
  sessionLabel: "讲解",
  integrations: "集成",
  delete: "删除",
  stepCounter: "第 {0} 步，共 {1} 步",
  stepUnit: "步",
  runsAfter: "执行于以下之后：",
  staleNotice: "该代码块在发布后移动或改变，因此没有高亮任何位置。",
  relocatedNotice: "代码块已移动。Agent CodeWalk 找到唯一匹配并高亮了它。",
  degradedNotice: "发布时没有完整的 baseline，范围可能包含更早的修改。",
  staleCompanionNotice:
    "该讲解由 companion {0} 发布，但当前安装的是 {1}。请重启 Agent 会话以加载新的 companion；在此之前它发布的讲解不会包含新功能。",
  uncoveredNotice: "没有讲解的修改：",
  excludedNotice: "有修改但不作为代码展示：",
  publishedNotice: "Agent CodeWalk：“{0}”已就绪，共 {1} 步。",
  explanationPublishedNotice: "Agent CodeWalk：关于“{0}”的讲解已就绪，共 {1} 步。",
  openWalkthrough: "打开讲解",
  noWalkthrough: "当前没有正在播放的 Agent CodeWalk 讲解。",
  explanationLabel: "代码讲解",
  changeLabel: "代码修改",
  kinds: {
    add: "新增",
    modify: "修改",
    delete: "删除",
    rename: "重命名",
    context: "上下文",
  },
};

/**
 * Chooses the table for an editor language tag such as `zh-cn` or `en-us`.
 *
 * @param language The value of `vscode.env.language`.
 * @returns The matching table, or English when the language is not translated.
 */
export function messagesFor(language: string): Messages {
  return language.toLowerCase().startsWith("zh") ? simplifiedChinese : english;
}

/** Substitutes `{0}`, `{1}`, … in a message. */
export function format(template: string, ...values: readonly (string | number)[]): string {
  return template.replaceAll(/\{(\d+)\}/gu, (match, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? match : String(value);
  });
}
