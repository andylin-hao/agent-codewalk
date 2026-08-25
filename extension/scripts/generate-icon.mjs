#!/usr/bin/env node
// Renders media/icon.png from the same geometry as media/icon.svg.
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

const BACKGROUND = [0x1f, 0x24, 0x30];
const CODE_LINE = [0xd6, 0xdc, 0xe8];
const ACCENT = [0x4f, 0xc1, 0xff];

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Straight strokes in `viewBox` units, mirroring the `d` attributes of icon.svg.
 *
 * @type {ReadonlyArray<{ readonly from: readonly [number, number], readonly to: readonly [number, number], readonly color: readonly number[] }>}
 */
const strokes = [
  { from: [5, 5], to: [13, 5], color: CODE_LINE },
  { from: [5, 10], to: [19, 10], color: CODE_LINE },
  { from: [5, 15], to: [10, 15], color: CODE_LINE },
  { from: [5, 20], to: [11, 20], color: CODE_LINE },
  { from: [16, 16], to: [19, 19], color: ACCENT },
  { from: [19, 19], to: [16, 22], color: ACCENT },
];

const STROKE_WIDTH = 1.8;
const CORNER_RADIUS = 5;

async function main() {
  const canvas = createCanvas();
  fillRoundedRectangle(canvas, 0, 0, VIEW_BOX, VIEW_BOX, CORNER_RADIUS, BACKGROUND);
  for (const stroke of strokes) {
    drawCapsule(canvas, stroke.from, stroke.to, STROKE_WIDTH / 2, stroke.color);
  }
  const pixels = downsample(canvas);
  const target = path.join(extensionRoot, "media", "icon.png");
  await fs.writeFile(target, encodePng(pixels, SIZE, SIZE));
  process.stdout.write(`Wrote ${path.relative(extensionRoot, target)} (${String(SIZE)}x${String(SIZE)}).\n`);
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
