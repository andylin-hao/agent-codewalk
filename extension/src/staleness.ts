/**
 * Compares two release numbers.
 *
 * @param left A version such as `0.6.1`.
 * @param right The version to compare it against.
 * @returns A negative number when `left` is older, zero when they match, positive when
 *   it is newer. Unparseable input compares equal, so a malformed version never
 *   produces a warning.
 */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    value
      .trim()
      .split(".")
      .map((part) => Number.parseInt(part, 10));
  const first = parse(left);
  const second = parse(right);
  if (first.length !== 3 || second.length !== 3 || [...first, ...second].some(Number.isNaN)) {
    return 0;
  }
  for (const [index, value] of first.entries()) {
    const other = second[index] ?? 0;
    if (value !== other) {
      return value - other;
    }
  }
  return 0;
}

/**
 * Decides whether a session was published by an out-of-date companion.
 *
 * An agent keeps the companion process it started with, so installing a new extension
 * does not update the binary a running session publishes through. The result is a
 * walkthrough that silently lacks whatever the newer protocol added, which reads as the
 * feature being broken rather than as the agent needing a restart. This is what lets the
 * sidebar say which it is.
 *
 * @param published The version recorded in the session, if it recorded one.
 * @param installed The version this extension ships.
 * @returns The published version when it is older, otherwise undefined.
 */
export function staleCompanion(
  published: string | undefined,
  installed: string,
): string | undefined {
  if (published === undefined) {
    // Sessions predating the stamp are common and say nothing about the running agent.
    return undefined;
  }
  return compareVersions(published, installed) < 0 ? published : undefined;
}
