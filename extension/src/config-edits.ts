import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

const PRODUCT = "agent-codewalk";
const TOML_START = "# >>> agent-codewalk managed block >>>";
const TOML_END = "# <<< agent-codewalk managed block <<<";
const FORMATTING = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;

export function upsertCodexConfiguration(
  existing: string,
  companionPath: string,
  platform: NodeJS.Platform,
): string {
  const command = hookShellCommand(companionPath, platform, "--hook-reminder");
  const promptCommand = hookShellCommand(companionPath, platform, "--prompt-reminder");
  const block = `${TOML_START}\n[mcp_servers.${PRODUCT}]\ncommand = ${JSON.stringify(companionPath)}\nargs = []\n\n[[hooks.UserPromptSubmit]]\n\n[[hooks.UserPromptSubmit.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(promptCommand)}\ntimeout = 5\nstatusMessage = "Loading Agent CodeWalk workflow"\n\n[[hooks.Stop]]\n\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(command)}\ntimeout = 5\nstatusMessage = "Checking Agent CodeWalk publication"\n${TOML_END}`;
  const start = existing.indexOf(TOML_START);
  const end = existing.indexOf(TOML_END);
  if (start >= 0 && end >= start) {
    return `${existing.slice(0, start)}${block}${existing.slice(end + TOML_END.length)}`;
  }
  if (existing.includes(`[mcp_servers.${PRODUCT}]`)) {
    throw new Error("an unowned mcp_servers.agent-codewalk entry already exists");
  }
  return `${existing.trimEnd()}${existing.trim().length === 0 ? "" : "\n\n"}${block}\n`;
}

export function removeCodexConfiguration(existing: string): string | undefined {
  const start = existing.indexOf(TOML_START);
  const end = existing.indexOf(TOML_END);
  if (start < 0 || end < start) {
    return undefined;
  }
  return `${existing.slice(0, start).trimEnd()}\n${existing.slice(end + TOML_END.length).trimStart()}`;
}

export function upsertJsonProperty(
  existing: string,
  propertyPath: readonly string[],
  value: unknown,
): string {
  const source = jsonSource(existing);
  validateJson(source);
  return applyEdits(
    source,
    modify(source, [...propertyPath], value, { formattingOptions: FORMATTING }),
  );
}

export function removeJsonPropertyIfOwned(
  existing: string,
  propertyPath: readonly string[],
  companionPath: string,
): string | undefined {
  const source = jsonSource(existing);
  const parsed = parseJson(source);
  if (!entryUsesCompanion(parsed, propertyPath, companionPath)) {
    return undefined;
  }
  return applyEdits(
    source,
    modify(source, [...propertyPath], undefined, { formattingOptions: FORMATTING }),
  );
}

export function upsertClaudeStopHook(
  existing: string,
  companionPath: string,
  platform: NodeJS.Platform,
): string {
  const source = jsonSource(existing);
  const parsed = parseJson(source);
  const current = nestedArray(parsed, ["hooks", "Stop"]);
  const retained = current.filter((entry) => !hookUsesCompanion(entry, companionPath));
  retained.push({
    hooks: [
      {
        type: "command",
        command: hookShellCommand(companionPath, platform, "--hook-reminder"),
        timeout: 5,
        statusMessage: "Checking Agent CodeWalk publication",
      },
    ],
  });
  const withStop = applyEdits(
    source,
    modify(source, ["hooks", "Stop"], retained, { formattingOptions: FORMATTING }),
  );
  const promptHooks = nestedArray(parsed, ["hooks", "UserPromptSubmit"]);
  const retainedPrompts = promptHooks.filter(
    (entry) => !hookUsesCompanion(entry, companionPath),
  );
  retainedPrompts.push({
    hooks: [
      {
        type: "command",
        command: hookShellCommand(companionPath, platform, "--prompt-reminder"),
        timeout: 5,
        statusMessage: "Loading Agent CodeWalk workflow",
      },
    ],
  });
  return applyEdits(
    withStop,
    modify(withStop, ["hooks", "UserPromptSubmit"], retainedPrompts, {
      formattingOptions: FORMATTING,
    }),
  );
}

export function removeClaudeStopHook(
  existing: string,
  companionPath: string,
): string | undefined {
  const source = jsonSource(existing);
  const parsed = parseJson(source);
  const current = nestedArray(parsed, ["hooks", "Stop"]);
  const retained = current.filter((entry) => !hookUsesCompanion(entry, companionPath));
  const promptHooks = nestedArray(parsed, ["hooks", "UserPromptSubmit"]);
  const retainedPrompts = promptHooks.filter(
    (entry) => !hookUsesCompanion(entry, companionPath),
  );
  if (
    retained.length === current.length &&
    retainedPrompts.length === promptHooks.length
  ) {
    return undefined;
  }
  let updated = source;
  if (retained.length !== current.length) {
    updated = applyEdits(
      source,
      modify(source, ["hooks", "Stop"], retained.length === 0 ? undefined : retained, {
        formattingOptions: FORMATTING,
      }),
    );
  }
  if (retainedPrompts.length !== promptHooks.length) {
    updated = applyEdits(
      updated,
      modify(
        updated,
        ["hooks", "UserPromptSubmit"],
        retainedPrompts.length === 0 ? undefined : retainedPrompts,
        { formattingOptions: FORMATTING },
      ),
    );
  }
  return updated;
}

function jsonSource(existing: string): string {
  return existing.trim().length === 0 ? "{}\n" : existing;
}

function validateJson(source: string): void {
  parseJson(source);
}

function parseJson(source: string): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    throw new Error("cannot safely update invalid JSON/JSONC");
  }
  return value;
}

function entryUsesCompanion(
  value: unknown,
  propertyPath: readonly string[],
  companionPath: string,
): boolean {
  let current = value;
  for (const property of propertyPath) {
    if (typeof current !== "object" || current === null || !(property in current)) {
      return false;
    }
    current = (current as Record<string, unknown>)[property];
  }
  if (typeof current !== "object" || current === null) {
    return false;
  }
  const command = (current as Record<string, unknown>).command;
  return companionPath === command || (Array.isArray(command) && command[0] === companionPath);
}

function nestedArray(value: unknown, propertyPath: readonly string[]): unknown[] {
  let current = value;
  for (const property of propertyPath) {
    if (typeof current !== "object" || current === null || !(property in current)) {
      return [];
    }
    current = (current as Record<string, unknown>)[property];
  }
  return Array.isArray(current) ? current : [];
}

function hookUsesCompanion(value: unknown, companionPath: string): boolean {
  if (typeof value !== "object" || value === null || !("hooks" in value)) {
    return false;
  }
  const hooks = (value as Record<string, unknown>).hooks;
  return (
    Array.isArray(hooks) &&
    hooks.some((hook: unknown) => {
      if (typeof hook !== "object" || hook === null) {
        return false;
      }
      const command = (hook as Record<string, unknown>).command;
      return (
        command === companionPath ||
        command === hookShellCommand(companionPath, "linux", "--hook-reminder") ||
        command === hookShellCommand(companionPath, "linux", "--prompt-reminder") ||
        command === hookShellCommand(companionPath, "win32", "--hook-reminder") ||
        command === hookShellCommand(companionPath, "win32", "--prompt-reminder")
      );
    })
  );
}

function hookShellCommand(
  companionPath: string,
  platform: NodeJS.Platform,
  argument: string,
): string {
  if (platform === "win32") {
    return `"${companionPath.replaceAll('"', '\\"')}" ${argument}`;
  }
  return `'${companionPath.replaceAll("'", "'\\''")}' ${argument}`;
}
