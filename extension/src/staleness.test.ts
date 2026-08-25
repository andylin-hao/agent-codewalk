import { describe, expect, it } from "vitest";

import { compareVersions, staleCompanion } from "./staleness.js";

describe("compareVersions", () => {
  it.each([
    ["0.6.0", "0.6.1"],
    ["0.6.9", "0.7.0"],
    ["0.9.9", "1.0.0"],
  ])("orders %s before %s", (older, newer) => {
    expect(compareVersions(older, newer)).toBeLessThan(0);
    expect(compareVersions(newer, older)).toBeGreaterThan(0);
  });

  it("treats equal versions as equal", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("compares each part as a number, not as text", () => {
    // "10" sorts before "9" as a string, which would silently invert the comparison.
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
  });

  it.each([["", "1.0.0"], ["1.0", "1.0.0"], ["next", "1.0.0"], ["1.0.0", "1.x.0"]])(
    "refuses to guess about %s",
    (left, right) => {
      expect(compareVersions(left, right)).toBe(0);
    },
  );
});

describe("staleCompanion", () => {
  it("names the publisher when it is behind", () => {
    expect(staleCompanion("0.5.0", "0.6.1")).toBe("0.5.0");
  });

  it("says nothing when the publisher matches", () => {
    expect(staleCompanion("0.6.1", "0.6.1")).toBeUndefined();
  });

  it("says nothing when the publisher is ahead", () => {
    // The editor is the stale one here, which is not what this warning is about.
    expect(staleCompanion("0.7.0", "0.6.1")).toBeUndefined();
  });

  it("says nothing about a session that recorded no version", () => {
    // Sessions predating the stamp are common and prove nothing about the running agent.
    expect(staleCompanion(undefined, "0.6.1")).toBeUndefined();
  });

  it("says nothing about an unparseable version", () => {
    expect(staleCompanion("dev", "0.6.1")).toBeUndefined();
  });
});
