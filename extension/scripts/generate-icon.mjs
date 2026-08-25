#!/usr/bin/env node
// Renders the theme-aware SVG and Marketplace PNG from one geometry definition.
//
// The VS Code Marketplace requires a raster icon, and adding a binary asset that
// nobody can regenerate is worse than keeping the few lines that draw it. The
// image is supersampled and box filtered, so the output is deterministic.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const SIZE = 128;
const SCALE = 4;
const CANVAS = SIZE * SCALE;
const VIEW_BOX = 24;
const UNIT = CANVAS / VIEW_BOX;

const BACKGROUND = [0x08, 0x0d, 0x1a];
const FRAME = [0x7f, 0x90, 0xb2];
const CYAN = [0x38, 0xe8, 0xff];
const VIOLET = [0x8a, 0x6c, 0xff];

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Straight strokes in `viewBox` units. Overlapping round-capped segments form the
 * open code frame and the route through its three waypoints.
 *
 * @type {ReadonlyArray<{ readonly from: readonly [number, number], readonly to: readonly [number, number], readonly color: readonly number[] }>}
 */
const frameStrokes = [
  { from: [10, 3.75], to: [5.25, 7.5], color: FRAME },
  { from: [5.25, 7.5], to: [5.25, 16.5], color: FRAME },
  { from: [5.25, 16.5], to: [10, 20.25], color: FRAME },
  { from: [14, 3.75], to: [18.75, 7.5], color: FRAME },
  { from: [18.75, 7.5], to: [18.75, 16.5], color: FRAME },
  { from: [18.75, 16.5], to: [14, 20.25], color: FRAME },
];

const routeStrokes = [
  { from: [9, 6.5], to: [9, 9], color: CYAN },
  { from: [9, 9], to: [12, 12], color: CYAN },
  { from: [12, 12], to: [12, 14.5], color: VIOLET },
  { from: [12, 14.5], to: [16, 17.5], color: VIOLET },
];

const nodes = [
  { center: [9, 6.5], color: CYAN },
  { center: [12, 12], color: VIOLET },
  { center: [16, 17.5], color: CYAN },
];

const FRAME_STROKE_WIDTH = 2.1;
const ROUTE_STROKE_WIDTH = 1.9;
const NODE_RADIUS = 1.45;
const CORNER_RADIUS = 5;
const CHECK_ONLY = process.argv.includes("--check");

const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--check");
if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument(s): ${unknownArguments.join(", ")}. Expected only --check.`);
}

async function main() {
  const canvas = createCanvas();
  fillRoundedRectangle(canvas, 0, 0, VIEW_BOX, VIEW_BOX, CORNER_RADIUS, BACKGROUND);
  for (const stroke of frameStrokes) {
    drawCapsule(canvas, stroke.from, stroke.to, FRAME_STROKE_WIDTH / 2, stroke.color);
  }
  for (const stroke of routeStrokes) {
    drawCapsule(canvas, stroke.from, stroke.to, ROUTE_STROKE_WIDTH / 2, stroke.color);
  }
  for (const node of nodes) {
    fillCircle(canvas, node.center, NODE_RADIUS, node.color);
  }
  const pixels = downsample(canvas);
  const assets = [
    {
      content: Buffer.from(renderSvg(), "utf8"),
      target: path.join(extensionRoot, "media", "icon.svg"),
    },
    {
      content: encodePng(pixels, SIZE, SIZE),
      target: path.join(extensionRoot, "media", "icon.png"),
    },
  ];

  if (CHECK_ONLY) {
    const stale = [];
    for (const asset of assets) {
      const existing = await fs.readFile(asset.target).catch(() => undefined);
      if (existing === undefined || !existing.equals(asset.content)) {
        stale.push(path.relative(extensionRoot, asset.target));
      }
    }
    if (stale.length > 0) {
      throw new Error(`Generated icon assets are stale: ${stale.join(", ")}. Run pnpm icon.`);
    }
    process.stdout.write("Verified media/icon.svg and media/icon.png.\n");
    return;
  }

  for (const asset of assets) {
    await fs.writeFile(asset.target, asset.content);
    process.stdout.write(`Wrote ${path.relative(extensionRoot, asset.target)}.\n`);
  }
}

/**
 * The activity bar needs a monochrome icon that inherits the active editor theme.
 * Its geometry deliberately matches the colored Marketplace rendering above.
 *
 * @returns {string}
 */
function renderSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" d="m10 3.75-4.75 3.75v9L10 20.25M14 3.75l4.75 3.75v9L14 20.25"/>
  <path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M9 6.5V9l3 3v2.5l4 3"/>
  <circle cx="9" cy="6.5" r="1.45" fill="currentColor"/>
  <circle cx="12" cy="12" r="1.45" fill="currentColor"/>
  <circle cx="16" cy="17.5" r="1.45" fill="currentColor"/>
</svg>
`;
}

/** @returns {{ readonly data: Uint8ClampedArray, readonly size: number }} */
function createCanvas() {
  return { data: new Uint8ClampedArray(CANVAS * CANVAS * 4), size: CANVAS };
}

/**
 * @param {{ readonly data: Uint8ClampedArray, readonly size: number }} canvas
 * @param {number} x
 * @param {number} y
 * @param {readonly number[]} color
 * @returns {void}
 */
function setPixel(canvas, x, y, color) {
  const offset = (y * canvas.size + x) * 4;
  canvas.data[offset] = color[0] ?? 0;
  canvas.data[offset + 1] = color[1] ?? 0;
  canvas.data[offset + 2] = color[2] ?? 0;
  canvas.data[offset + 3] = 0xff;
}

/**
 * @param {{ readonly data: Uint8ClampedArray, readonly size: number }} canvas
 * @param {number} left
 * @param {number} top
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @param {readonly number[]} color
 * @returns {void}
 */
function fillRoundedRectangle(canvas, left, top, width, height, radius, color) {
  for (let pixelY = 0; pixelY < canvas.size; pixelY += 1) {
    for (let pixelX = 0; pixelX < canvas.size; pixelX += 1) {
      const x = (pixelX + 0.5) / UNIT;
      const y = (pixelY + 0.5) / UNIT;
      if (x < left || x > left + width || y < top || y > top + height) {
        continue;
      }
      const insetX = Math.min(x - left, left + width - x);
      const insetY = Math.min(y - top, top + height - y);
      if (insetX < radius && insetY < radius) {
        const dx = radius - insetX;
        const dy = radius - insetY;
        if (Math.hypot(dx, dy) > radius) {
          continue;
        }
      }
      setPixel(canvas, pixelX, pixelY, color);
    }
  }
}

/**
 * Draws a round-capped segment, which is how SVG renders `stroke-linecap="round"`.
 *
 * @param {{ readonly data: Uint8ClampedArray, readonly size: number }} canvas
 * @param {readonly [number, number]} from
 * @param {readonly [number, number]} to
 * @param {number} radius
 * @param {readonly number[]} color
 * @returns {void}
 */
function drawCapsule(canvas, from, to, radius, color) {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  for (let pixelY = 0; pixelY < canvas.size; pixelY += 1) {
    for (let pixelX = 0; pixelX < canvas.size; pixelX += 1) {
      const x = (pixelX + 0.5) / UNIT;
      const y = (pixelY + 0.5) / UNIT;
      const projection =
        lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / lengthSquared));
      const distance = Math.hypot(x - (x0 + projection * dx), y - (y0 + projection * dy));
      if (distance <= radius) {
        setPixel(canvas, pixelX, pixelY, color);
      }
    }
  }
}

/**
 * @param {{ readonly data: Uint8ClampedArray, readonly size: number }} canvas
 * @param {readonly [number, number]} center
 * @param {number} radius
 * @param {readonly number[]} color
 * @returns {void}
 */
function fillCircle(canvas, center, radius, color) {
  for (let pixelY = 0; pixelY < canvas.size; pixelY += 1) {
    for (let pixelX = 0; pixelX < canvas.size; pixelX += 1) {
      const x = (pixelX + 0.5) / UNIT;
      const y = (pixelY + 0.5) / UNIT;
      if (Math.hypot(x - center[0], y - center[1]) <= radius) {
        setPixel(canvas, pixelX, pixelY, color);
      }
    }
  }
}

/**
 * @param {{ readonly data: Uint8ClampedArray, readonly size: number }} canvas
 * @returns {Buffer}
 */
function downsample(canvas) {
  const output = Buffer.alloc(SIZE * SIZE * 4);
  const samples = SCALE * SCALE;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let subY = 0; subY < SCALE; subY += 1) {
        for (let subX = 0; subX < SCALE; subX += 1) {
          const offset = ((y * SCALE + subY) * canvas.size + (x * SCALE + subX)) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            totals[channel] += canvas.data[offset + channel] ?? 0;
          }
        }
      }
      const target = (y * SIZE + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[target + channel] = Math.round((totals[channel] ?? 0) / samples);
      }
    }
  }
  return output;
}

/**
 * @param {Buffer} pixels RGBA rows without filter bytes.
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function encodePng(pixels, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, checksum]);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * @param {Buffer} data
 * @returns {number}
 */
function crc32(data) {
  let crc = 0xff_ff_ff_ff;
  for (const byte of data) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

await main();
