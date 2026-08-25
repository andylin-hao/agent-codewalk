import { promises as fs, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import * as vscode from "vscode";

import {
  removeClaudeStopHook,
  removeCodexConfiguration as removeCodexConfigurationText,
  removeJsonPropertyIfOwned,
  upsertClaudeStopHook,
  upsertCodexConfiguration,
  upsertJsonProperty,
} from "./config-edits.js";
import { dataDirectory } from "./storage.js";
import { withFileTransaction } from "./file-transaction.js";

const PRODUCT = "agent-codewalk";
const VERSION = "0.1.1";

type AgentName = "Codex" | "Claude Code" | "OpenCode";

interface AgentTarget {
  readonly name: AgentName;
  readonly executable: string;
  readonly configPath: string;
  readonly skillPath: string;
  readonly hookPath?: string;
}

interface InstallationManifest {
  readonly product: typeof PRODUCT;
  readonly version: string;
  readonly companionPath: string;
  readonly agents: readonly AgentName[];
  readonly configPaths: readonly string[];
  readonly skillPaths: readonly string[];
}

interface SetupResult {
  readonly companionPath: string;
  readonly agents: readonly AgentName[];
  readonly warnings: readonly string[];
}

export class IntegrationInstaller {
  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
  ) {}

  public async setup(): Promise<void> {
    const targets = await detectedTargets();
    const source = await this.resolveCompanionSource();
    const planned = [
      `Companion: ${path.join(dataDirectory(), "bin", VERSION, executableName())}`,
      ...targets.flatMap((target) => [
        `${target.name} MCP config: ${target.configPath}`,
        `${target.name} skill: ${target.skillPath}`,
        ...(target.hookPath === undefined ? [] : [`${target.name} hooks: ${target.hookPath}`]),
      ]),
    ];
    const confirmation = await vscode.window.showInformationMessage(
      `Agent CodeWalk will install a local companion and update these user-level files:\n\n${planned.join("\n")}`,
      { modal: true },
      "Install",
    );
    if (confirmation !== "Install") {
      return;
    }
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Setting up Agent CodeWalk integrations",
        cancellable: false,
      },
      () => this.performSetup(source, targets),
    );
    const agentSummary = result.agents.length === 0 ? "no installed agents were detected" : result.agents.join(", ");
    const warning = result.warnings.length === 0 ? "" : ` ${result.warnings.join(" ")}`;
    await vscode.window.showInformationMessage(
      `Agent CodeWalk is ready for ${agentSummary}. Restart active agent sessions to load the MCP server and skill. Codex may ask you to review the new Stop hook in /hooks.${warning}`,
    );
  }

  public async diagnose(): Promise<void> {
    this.output.show(true);
    this.output.info(`Data directory: ${dataDirectory()}`);
    const manifest = await readManifest();
    if (manifest === undefined) {
      this.output.warn("No integration installation manifest was found.");
      return;
    }
    this.output.info(`Companion: ${manifest.companionPath}`);
    this.output.info(`Configured agents: ${manifest.agents.join(", ") || "none"}`);
    try {
      await fs.access(manifest.companionPath, fsConstants.X_OK);
      this.output.info("Companion executable: OK");
    } catch (error) {
      this.output.error(`Companion executable is unavailable: ${errorMessage(error)}`);
    }
    for (const configPath of manifest.configPaths) {
      this.output.info(`${configPath}: ${(await exists(configPath)) ? "present" : "missing"}`);
    }
    for (const skillPath of manifest.skillPaths) {
      this.output.info(`${skillPath}: ${(await isOwnedSkill(skillPath)) ? "owned skill present" : "missing or not owned"}`);
    }
  }

  public async uninstall(): Promise<void> {
    const manifest = await readManifest();
    if (manifest === undefined) {
      await vscode.window.showInformationMessage("No Agent CodeWalk Agent integrations are installed.");
      return;
    }
    const confirmation = await vscode.window.showWarningMessage(
      "Remove Agent CodeWalk MCP entries, owned skills, and the installed companion? Walkthrough sessions will be kept.",
      { modal: true },
      "Remove",
    );
    if (confirmation !== "Remove") {
      return;
    }
    for (const skillPath of manifest.skillPaths) {
      if (await isOwnedSkill(skillPath)) {
        await fs.rm(skillPath, { recursive: true, force: true });
      }
    }
    await removeCodexConfiguration(path.join(os.homedir(), ".codex", "config.toml"));
    await removeJsonConfiguration(path.join(os.homedir(), ".claude.json"), ["mcpServers", PRODUCT], manifest.companionPath);
    await removeClaudeHook(
      path.join(os.homedir(), ".claude", "settings.json"),
      manifest.companionPath,
    );
    for (const openCodePath of openCodeConfigCandidates()) {
      await removeJsonConfiguration(openCodePath, ["mcp", PRODUCT], manifest.companionPath);
    }
    await fs.rm(path.join(dataDirectory(), "bin"), { recursive: true, force: true });
    await fs.rm(manifestPath(), { force: true });
    await vscode.window.showInformationMessage("Agent CodeWalk Agent integrations were removed.");
  }

  private async performSetup(source: string, targets: readonly AgentTarget[]): Promise<SetupResult> {
    const transactionRoot = path.join(dataDirectory(), "transactions", randomUUID());
    const setupTargets = uniquePaths([
      companionDestination(),
      manifestPath(),
      ...targets.flatMap(pathsForTarget),
    ]);
    return withFileTransaction(transactionRoot, setupTargets, async () => {
      const companionPath = await installCompanion(source);
      const warnings: string[] = [];
      const configuredAgents: AgentName[] = [];
      const configPaths: string[] = [];
      const skillPaths: string[] = [];
      for (const target of targets) {
        try {
          await withFileTransaction(
            path.join(dataDirectory(), "transactions", randomUUID()),
            pathsForTarget(target),
            async () => {
              await installOwnedSkill(
                path.join(this.context.extensionPath, "resources", "agent-codewalk"),
                target.skillPath,
              );
              await configureTarget(target, companionPath);
            },
          );
          configuredAgents.push(target.name);
          configPaths.push(target.configPath);
          if (target.hookPath !== undefined) {
            configPaths.push(target.hookPath);
          }
          skillPaths.push(target.skillPath);
        } catch (error) {
          const warning = `${target.name} was skipped and rolled back: ${errorMessage(error)}`;
          warnings.push(warning);
          this.output.warn(warning);
        }
      }
      const manifest: InstallationManifest = {
        product: PRODUCT,
        version: VERSION,
        companionPath,
        agents: configuredAgents,
        configPaths: uniquePaths(configPaths),
        skillPaths: uniquePaths(skillPaths),
      };
      await writeJsonAtomic(manifestPath(), manifest);
      return { companionPath, agents: configuredAgents, warnings };
    });
  }

  private async resolveCompanionSource(): Promise<string> {
    const configured = vscode.workspace
      .getConfiguration("agentCodeWalk")
      .get<string>("companionPath", "")
      .trim();
    const candidates = [
      configured,
      path.join(this.context.extensionPath, "bin", executableName()),
      path.resolve(this.context.extensionPath, "..", "target", "release", executableName()),
      path.resolve(this.context.extensionPath, "..", "target", "debug", executableName()),
    ].filter((candidate) => candidate.length > 0);
    for (const candidate of candidates) {
      if (await exists(candidate)) {
        return candidate;
      }
    }
    throw new Error(
      "No MCP companion executable was found. Build it with `cargo build --release` or set agentCodeWalk.companionPath.",
    );
  }
}

async function detectedTargets(): Promise<AgentTarget[]> {
  const home = os.homedir();
  const definitions: AgentTarget[] = [
    {
      name: "Codex",
      executable: "codex",
      configPath: path.join(home, ".codex", "config.toml"),
      skillPath: path.join(home, ".agents", "skills", PRODUCT),
    },
    {
      name: "Claude Code",
      executable: "claude",
      configPath: path.join(home, ".claude.json"),
      skillPath: path.join(home, ".claude", "skills", PRODUCT),
      hookPath: path.join(home, ".claude", "settings.json"),
    },
    {
      name: "OpenCode",
      executable: "opencode",
      configPath: await preferredOpenCodeConfig(),
      skillPath: path.join(home, ".agents", "skills", PRODUCT),
    },
  ];
  const targets: AgentTarget[] = [];
  for (const definition of definitions) {
    if ((await executableExists(definition.executable)) || (await exists(path.dirname(definition.configPath)))) {
      targets.push(definition);
    }
  }
  return targets;
}

async function configureTarget(target: AgentTarget, companionPath: string): Promise<void> {
  switch (target.name) {
    case "Codex":
      await configureCodex(target.configPath, companionPath);
      break;
    case "Claude Code":
      await updateJsonConfiguration(target.configPath, ["mcpServers", PRODUCT], {
        type: "stdio",
        command: companionPath,
        args: [],
      });
      if (target.hookPath !== undefined) {
        await configureClaudeHook(target.hookPath, companionPath);
      }
      break;
    case "OpenCode":
      await updateJsonConfiguration(target.configPath, ["mcp", PRODUCT], {
        type: "local",
        command: [companionPath],
        enabled: true,
      });
      break;
  }
}

async function installCompanion(source: string): Promise<string> {
  const destination = companionDestination();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${randomUUID()}`;
  try {
    await fs.copyFile(source, temporary);
    if (process.platform !== "win32") {
      await fs.chmod(temporary, 0o755);
    }
    await renameReplacing(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return destination;
}

function companionDestination(): string {
  return path.join(dataDirectory(), "bin", VERSION, executableName());
}

function pathsForTarget(target: AgentTarget): string[] {
  return uniquePaths([
    target.configPath,
    target.skillPath,
    ...(target.hookPath === undefined ? [] : [target.hookPath]),
  ]);
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((candidate) => path.resolve(candidate)))];
}

async function installOwnedSkill(source: string, destination: string): Promise<void> {
  if ((await exists(destination)) && !(await isOwnedSkill(destination))) {
    throw new Error(`refusing to overwrite an unowned skill at ${destination}`);
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${randomUUID()}`;
  await fs.cp(source, temporary, { recursive: true, errorOnExist: true });
  await writeJsonAtomic(path.join(temporary, ".agent-codewalk-owner.json"), {
    product: PRODUCT,
    version: VERSION,
  });
  if (await exists(destination)) {
    await fs.rm(destination, { recursive: true });
  }
  try {
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function isOwnedSkill(skillPath: string): Promise<boolean> {
  try {
    const value: unknown = JSON.parse(
      await fs.readFile(path.join(skillPath, ".agent-codewalk-owner.json"), "utf8"),
    );
    return typeof value === "object" && value !== null && "product" in value && value.product === PRODUCT;
  } catch {
    return false;
  }
}

async function configureCodex(configPath: string, companionPath: string): Promise<void> {
  const existing = await readOptional(configPath);
  await backupAndWrite(
    configPath,
    upsertCodexConfiguration(existing, companionPath, process.platform),
  );
}

async function removeCodexConfiguration(configPath: string): Promise<void> {
  const existing = await readOptional(configPath);
  const updated = removeCodexConfigurationText(existing);
  if (updated !== undefined) {
    await backupAndWrite(configPath, updated);
  }
}

async function configureClaudeHook(configPath: string, companionPath: string): Promise<void> {
  const existing = await readOptional(configPath);
  await backupAndWrite(
    configPath,
    upsertClaudeStopHook(existing, companionPath, process.platform),
  );
}

async function removeClaudeHook(configPath: string, companionPath: string): Promise<void> {
  if (!(await exists(configPath))) {
    return;
  }
  const source = await fs.readFile(configPath, "utf8");
  const updated = removeClaudeStopHook(source, companionPath);
  if (updated !== undefined) {
    await backupAndWrite(configPath, updated);
  }
}

async function updateJsonConfiguration(
  configPath: string,
  propertyPath: readonly string[],
  value: unknown,
): Promise<void> {
  const existing = await readOptional(configPath);
  await backupAndWrite(configPath, upsertJsonProperty(existing, propertyPath, value));
}

async function removeJsonConfiguration(
  configPath: string,
  propertyPath: readonly string[],
  expectedCompanionPath: string,
): Promise<void> {
  if (!(await exists(configPath))) {
    return;
  }
  const source = await fs.readFile(configPath, "utf8");
  const updated = removeJsonPropertyIfOwned(source, propertyPath, expectedCompanionPath);
  if (updated !== undefined) {
    await backupAndWrite(configPath, updated);
  }
}

async function backupAndWrite(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (await exists(target)) {
    await fs.copyFile(target, `${target}.agent-codewalk.bak`);
  }
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await renameReplacing(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function renameReplacing(source: string, destination: string): Promise<void> {
  try {
    await fs.rename(source, destination);
  } catch (error) {
    if (!(await exists(destination))) {
      throw error;
    }
    await fs.rm(destination, { recursive: true, force: true });
    await fs.rename(source, destination);
  }
}

async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await backupAndWrite(target, `${JSON.stringify(value, undefined, 2)}\n`);
}

async function readManifest(): Promise<InstallationManifest | undefined> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(manifestPath(), "utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      !("product" in value) ||
      value.product !== PRODUCT
    ) {
      return undefined;
    }
    const candidate = value as Record<string, unknown>;
    return {
      product: PRODUCT,
      version: typeof candidate.version === "string" ? candidate.version : "unknown",
      companionPath: typeof candidate.companionPath === "string" ? candidate.companionPath : "",
      agents: Array.isArray(candidate.agents) ? (candidate.agents as AgentName[]) : [],
      configPaths: Array.isArray(candidate.configPaths) ? (candidate.configPaths as string[]) : [],
      skillPaths: Array.isArray(candidate.skillPaths) ? (candidate.skillPaths as string[]) : [],
    };
  } catch {
    return undefined;
  }
}

function manifestPath(): string {
  return path.join(dataDirectory(), "installation.json");
}

async function preferredOpenCodeConfig(): Promise<string> {
  for (const candidate of openCodeConfigCandidates()) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return openCodeConfigCandidates()[0] ?? path.join(os.homedir(), ".config", "opencode", "opencode.json");
}

function openCodeConfigCandidates(): string[] {
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return [path.join(base, "opencode", "opencode.json"), path.join(base, "opencode", "opencode.jsonc")];
}

async function executableExists(name: string): Promise<boolean> {
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const extension of extensions) {
      if (await exists(path.join(directory, `${name}${extension.toLowerCase()}`))) {
        return true;
      }
      if (extension !== extension.toLowerCase() && (await exists(path.join(directory, `${name}${extension}`)))) {
        return true;
      }
    }
  }
  return false;
}

async function readOptional(target: string): Promise<string> {
  try {
    return await fs.readFile(target, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return "";
    }
    throw error;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function executableName(): string {
  return process.platform === "win32" ? "agent-codewalk-mcp.exe" : "agent-codewalk-mcp";
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
