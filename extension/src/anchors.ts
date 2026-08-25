import { createHash } from "node:crypto";

import type { CodeAnchor, ResolvedAnchor } from "./types.js";

export function hashCodeBlock(value: string): string {
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return createHash("sha256").update(normalized).digest("hex");
}

export function resolveAnchor(text: string, anchor: CodeAnchor): ResolvedAnchor | undefined {
  const lines = splitLines(text);
  const hinted = selectedText(lines, anchor.startLine, anchor.endLine);
  if (hinted !== undefined && hashCodeBlock(hinted) === anchor.normalizedHash) {
    return {
      startLine: anchor.startLine,
      endLine: anchor.endLine,
      relocated: false,
    };
  }

  if (anchor.lineCount > lines.length || anchor.lineCount < 1) {
    return undefined;
  }
  const matches: number[] = [];
  for (let start = 1; start + anchor.lineCount - 1 <= lines.length; start += 1) {
    const end = start + anchor.lineCount - 1;
    const candidate = selectedText(lines, start, end);
    if (candidate !== undefined && hashCodeBlock(candidate) === anchor.normalizedHash) {
      matches.push(start);
      if (matches.length > 1) {
        return undefined;
      }
    }
  }
  const relocatedStart = matches[0];
  if (relocatedStart === undefined) {
    return undefined;
  }
  return {
    startLine: relocatedStart,
    endLine: relocatedStart + anchor.lineCount - 1,
    relocated: true,
  };
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function selectedText(lines: readonly string[], startLine: number, endLine: number): string | undefined {
  if (startLine < 1 || endLine < startLine || endLine > lines.length) {
    return undefined;
  }
  return lines.slice(startLine - 1, endLine).join("\n");
}

