import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const svgUrl = new URL("../media/icon.svg", import.meta.url);
const pngUrl = new URL("../media/icon.png", import.meta.url);

describe("extension icon assets", () => {
  it("keeps the Activity Bar mark monochrome and theme-aware", async () => {
    const svg = await readFile(svgUrl, "utf8");

    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg.match(/currentColor/gu)).toHaveLength(5);
    expect(svg.match(/<circle/gu)).toHaveLength(3);
    expect(svg).not.toMatch(/#[\da-f]{3,8}/iu);
  });

  it("ships a square RGBA Marketplace icon at the required size", async () => {
    const png = await readFile(pngUrl);

    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.readUInt32BE(20)).toBe(128);
    expect(png[25]).toBe(6);
  });
});
