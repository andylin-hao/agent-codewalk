import type {
  AgentKind,
  ChangeHunk,
  ChangeKind,
  CodeAnchor,
  ExcludedChange,
  Walkthrough,
  WalkthroughStep,
} from "./types.js";

export class WalkthroughValidationError extends Error {}

export function parseWalkthrough(value: unknown): Walkthrough {
  const object = record(value, "walkthrough");
  exactKeys(
    object,
    [
      "schemaVersion",
      "kind",
      "id",
      "workspaceFingerprint",
      "title",
      "summary",
      "agent",
      "task",
      "createdAt",
      "steps",
      "fileOrder",
      "flowOrder",
      "changedHunks",
      "uncoveredHunks",
      "excludedChanges",
      "degradedBaseline",
    ],
    "walkthrough",
  );
  literal(object.schemaVersion, 1, "schemaVersion");
  const steps = array(object.steps, "steps").map((step, index) =>
    parseStep(step, `steps[${String(index)}]`),
  );
  if (steps.length === 0) {
    fail("steps must not be empty");
  }
  if (steps.length > 500) {
    fail("steps must contain at most 500 items");
  }
  const stepIdentifiers = new Set(steps.map((step) => step.id));
  const fileOrder = stringArray(object.fileOrder, "fileOrder");
  const flowOrder = stringArray(object.flowOrder, "flowOrder");
  validateOrder(fileOrder, stepIdentifiers, "fileOrder");
  validateOrder(flowOrder, stepIdentifiers, "flowOrder");
  validateFlow(steps, flowOrder, stepIdentifiers);
  const agent = record(object.agent, "agent");
  const task = record(object.task, "task");
  exactKeys(agent, ["kind", "sessionId"], "agent");
  exactKeys(task, ["id", "goal", "startedAt", "completedAt"], "task");
  const result: Walkthrough = {
    schemaVersion: 1,
    kind: enumeration(object.kind, ["change", "explanation"] as const, "kind"),
    id: string(object.id, "id"),
    workspaceFingerprint: hash(object.workspaceFingerprint, "workspaceFingerprint"),
    title: boundedString(object.title, "title", 200),
    summary: boundedString(object.summary, "summary", 10_000),
    agent: {
      kind: enumeration(
        agent.kind,
        ["codex", "claude-code", "opencode", "other"] as const,
        "agent.kind",
      ) satisfies AgentKind,
      ...(agent.sessionId === undefined
        ? {}
        : { sessionId: string(agent.sessionId, "agent.sessionId") }),
    },
    task: {
      id: string(task.id, "task.id"),
      goal: string(task.goal, "task.goal"),
      startedAt: date(task.startedAt, "task.startedAt"),
      completedAt: date(task.completedAt, "task.completedAt"),
    },
    createdAt: date(object.createdAt, "createdAt"),
    steps,
    fileOrder,
    flowOrder,
    changedHunks: parseHunks(object.changedHunks, "changedHunks"),
    uncoveredHunks: parseHunks(object.uncoveredHunks, "uncoveredHunks"),
    excludedChanges: array(object.excludedChanges, "excludedChanges").map(parseExcluded),
    degradedBaseline: boolean(object.degradedBaseline, "degradedBaseline"),
  };
  if (result.uncoveredHunks.length > 0 && !result.degradedBaseline) {
    fail("uncoveredHunks is only allowed when degradedBaseline is true");
  }
  if (result.kind === "explanation") {
    validateExplanation(result);
  }
  return result;
}

/**
 * Enforces what it means for a walkthrough to explain rather than record a change.
 *
 * An explanation is published without a baseline and without a diff, so a document that
 * claims to be one while carrying change data was not produced by this protocol.
 */
function validateExplanation(walkthrough: Walkthrough): void {
  if (walkthrough.changedHunks.length > 0) {
    fail("an explanation walkthrough must not report changed hunks");
  }
  if (walkthrough.uncoveredHunks.length > 0) {
    fail("an explanation walkthrough must not report uncovered hunks");
  }
  if (walkthrough.degradedBaseline) {
    fail("an explanation walkthrough cannot have a degraded baseline");
  }
  for (const step of walkthrough.steps) {
    if (step.changeKind !== "context") {
      fail(`an explanation walkthrough may only contain context steps: ${step.id}`);
    }
    if (step.previousText !== undefined) {
      fail(`an explanation walkthrough step cannot record replaced text: ${step.id}`);
    }
    if (!step.targetAvailable) {
      fail(`an explanation walkthrough step must point at code that exists: ${step.id}`);
    }
  }
}

function parseStep(value: unknown, field: string): WalkthroughStep {
  const object = record(value, field);
  exactKeys(
    object,
    [
      "id",
      "path",
      "title",
      "explanation",
      "changeKind",
      "anchor",
      "flowAfter",
      "targetAvailable",
      "previousText",
    ],
    field,
  );
  const path = relativePath(object.path, `${field}.path`);
  return {
    id: boundedString(object.id, `${field}.id`, 100),
    path,
    title: boundedString(object.title, `${field}.title`, 200),
    explanation: boundedString(object.explanation, `${field}.explanation`, 10_000),
    changeKind: enumeration(
      object.changeKind,
      ["add", "modify", "delete", "rename", "context"] as const,
      `${field}.changeKind`,
    ) satisfies ChangeKind,
    anchor: parseAnchor(object.anchor, `${field}.anchor`),
    flowAfter: uniqueStringArray(object.flowAfter, `${field}.flowAfter`),
    targetAvailable: boolean(object.targetAvailable, `${field}.targetAvailable`),
    ...(object.previousText === undefined
      ? {}
      : { previousText: boundedString(object.previousText, `${field}.previousText`, 4_100) }),
  };
}

function parseAnchor(value: unknown, field: string): CodeAnchor {
  const object = record(value, field);
  exactKeys(object, ["startLine", "endLine", "lineCount", "normalizedHash", "symbol"], field);
  const startLine = positiveInteger(object.startLine, `${field}.startLine`);
  const endLine = positiveInteger(object.endLine, `${field}.endLine`);
  if (endLine < startLine) {
    fail(`${field}.endLine must not precede startLine`);
  }
  const lineCount = positiveInteger(object.lineCount, `${field}.lineCount`);
  if (lineCount !== endLine - startLine + 1) {
    fail(`${field}.lineCount must match the selected range`);
  }
  return {
    startLine,
    endLine,
    lineCount,
    normalizedHash: hash(object.normalizedHash, `${field}.normalizedHash`),
    ...(object.symbol === undefined
      ? {}
      : { symbol: string(object.symbol, `${field}.symbol`) }),
  };
}

function parseHunks(value: unknown, field: string): ChangeHunk[] {
  return array(value, field).map((hunk, index) =>
    parseHunk(hunk, `${field}[${String(index)}]`),
  );
}

function parseHunk(value: unknown, field: string): ChangeHunk {
  const object = record(value, field);
  exactKeys(object, ["path", "startLine", "endLine", "kind"], field);
  const startLine = positiveInteger(object.startLine, `${field}.startLine`);
  const endLine = positiveInteger(object.endLine, `${field}.endLine`);
  if (endLine < startLine) {
    fail(`${field}.endLine must not precede startLine`);
  }
  return {
    path: relativePath(object.path, `${field}.path`),
    startLine,
    endLine,
    kind: enumeration(
      object.kind,
      ["add", "modify", "delete"] as const,
      `${field}.kind`,
    ),
  };
}

function parseExcluded(value: unknown, index: number): ExcludedChange {
  const field = `excludedChanges[${String(index)}]`;
  const object = record(value, field);
  exactKeys(object, ["path", "reason"], field);
  return {
    path: relativePath(object.path, `${field}.path`),
    reason: string(object.reason, `${field}.reason`),
  };
}

function validateFlow(
  steps: readonly WalkthroughStep[],
  flowOrder: readonly string[],
  identifiers: Set<string>,
): void {
  const positions = new Map(flowOrder.map((identifier, index) => [identifier, index]));
  for (const step of steps) {
    for (const predecessor of step.flowAfter) {
      if (!identifiers.has(predecessor)) {
        fail(`step ${step.id} references an unknown flow predecessor: ${predecessor}`);
      }
      if (predecessor === step.id) {
        fail(`step ${step.id} cannot depend on itself`);
      }
      const predecessorPosition = positions.get(predecessor);
      const stepPosition = positions.get(step.id);
      if (
        predecessorPosition === undefined ||
        stepPosition === undefined ||
        predecessorPosition >= stepPosition
      ) {
        fail(`flowOrder does not place ${predecessor} before ${step.id}`);
      }
    }
  }
}

function validateOrder(order: readonly string[], identifiers: Set<string>, field: string): void {
  if (order.length !== identifiers.size || new Set(order).size !== order.length) {
    fail(`${field} must contain every step exactly once`);
  }
  for (const identifier of order) {
    if (!identifiers.has(identifier)) {
      fail(`${field} contains unknown step: ${identifier}`);
    }
  }
}

function relativePath(value: unknown, field: string): string {
  const result = string(value, field).replaceAll("\\", "/");
  if (result.startsWith("/") || /^[a-zA-Z]:\//u.test(result)) {
    fail(`${field} must be relative to the workspace`);
  }
  if (result.split("/").some((component) => component === "..")) {
    fail(`${field} must not contain parent traversal`);
  }
  return result;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${field} must be an array`);
  }
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  return array(value, field).map((item, index) => string(item, `${field}[${String(index)}]`));
}

function uniqueStringArray(value: unknown, field: string): string[] {
  const result = stringArray(value, field);
  if (new Set(result).size !== result.length) {
    fail(`${field} must contain unique values`);
  }
  return result;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function boundedString(value: unknown, field: string, maximum: number): string {
  const result = string(value, field);
  const characters = Array.from(result).length;
  if (characters > maximum) {
    fail(`${field} must contain at most ${String(maximum)} characters`);
  }
  return result;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unexpected !== undefined) {
    fail(`${field} contains an unknown property: ${unexpected}`);
  }
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${field} must be a boolean`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(`${field} must be a positive integer`);
  }
  return value;
}

function hash(value: unknown, field: string): string {
  const result = string(value, field);
  if (!/^[a-f0-9]{64}$/u.test(result)) {
    fail(`${field} must be a lowercase SHA-256 hash`);
  }
  return result;
}

function date(value: unknown, field: string): string {
  const result = string(value, field);
  if (Number.isNaN(Date.parse(result))) {
    fail(`${field} must be an ISO date-time`);
  }
  return result;
}

function literal(value: unknown, expected: unknown, field: string): void {
  if (value !== expected) {
    fail(`${field} must equal ${String(expected)}`);
  }
}

function enumeration<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  field: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    fail(`${field} has an unsupported value`);
  }
  return value;
}

function fail(message: string): never {
  throw new WalkthroughValidationError(message);
}
