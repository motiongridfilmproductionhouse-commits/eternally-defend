import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { detectGridTiles } from "./grid-detect.server";

/**
 * Builds a synthetic "Instagram screenshot": a uniform header band on top
 * (simulating profile chrome) followed by an N x N grid of visually distinct
 * random-noise-textured squares separated by thin uniform white gutters
 * (simulating the actual post grid). Random noise (rather than flat color)
 * gives each tile real internal variance, like an actual photo would.
 */
async function buildSyntheticGridScreenshot(opts: {
  width?: number;
  headerHeight?: number;
  columns?: number;
  rows?: number;
  gutter?: number;
}): Promise<{ bytes: Uint8Array; headerHeight: number; tileSize: number; gutter: number }> {
  const width = opts.width ?? 300;
  const headerHeight = opts.headerHeight ?? 120;
  const columns = opts.columns ?? 3;
  const rows = opts.rows ?? 3;
  const gutter = opts.gutter ?? 4;

  const tileSize = Math.floor((width - gutter * (columns + 1)) / columns);
  const gridHeight = rows * tileSize + gutter * (rows + 1);
  const height = headerHeight + gridHeight;

  const channels = 3;
  const buf = Buffer.alloc(width * height * channels, 235); // near-white background everywhere

  // Header: flat mid-gray (near-zero variance).
  for (let y = 0; y < headerHeight; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      buf[idx] = 200;
      buf[idx + 1] = 200;
      buf[idx + 2] = 200;
    }
  }

  // Grid tiles: pseudo-random noise per tile so each tile has strong
  // internal variance, distinct from its neighbors' seed.
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const tileX = gutter + c * (tileSize + gutter);
      const tileY = headerHeight + gutter + r * (tileSize + gutter);
      for (let ty = 0; ty < tileSize; ty++) {
        for (let tx = 0; tx < tileSize; tx++) {
          const x = tileX + tx;
          const y = tileY + ty;
          const idx = (y * width + x) * channels;
          const v = Math.floor(rand() * 255);
          buf[idx] = v;
          buf[idx + 1] = Math.floor(rand() * 255);
          buf[idx + 2] = Math.floor(rand() * 255);
        }
      }
    }
  }

  const bytes = await sharp(buf, { raw: { width, height, channels } })
    .jpeg({ quality: 95 })
    .toBuffer();
  return { bytes: new Uint8Array(bytes), headerHeight, tileSize, gutter };
}

async function buildSyntheticSinglePhoto(width = 300, height = 300): Promise<Uint8Array> {
  const channels = 3;
  const buf = Buffer.alloc(width * height * channels);
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(rand() * 255);
  const bytes = await sharp(buf, { raw: { width, height, channels } })
    .jpeg({ quality: 95 })
    .toBuffer();
  return new Uint8Array(bytes);
}

test("detects a 3x3 grid, excludes the header band, and recovers 9 roughly-square tiles", async () => {
  const { bytes, headerHeight } = await buildSyntheticGridScreenshot({});
  const result = await detectGridTiles(bytes);

  assert.notEqual(result.confidence, "NONE");
  assert.equal(result.tiles.length, 9);
  for (const tile of result.tiles) {
    // No tile should reach up into the header band.
    assert.ok(
      tile.y >= headerHeight - 5,
      `tile y=${tile.y} should be below header ${headerHeight}`,
    );
    const ratio = tile.width / tile.height;
    assert.ok(
      ratio > 0.7 && ratio < 1.3,
      `tile should be roughly square, got ${tile.width}x${tile.height}`,
    );
  }
});

test("a single non-grid photo (uniform noise, no gutters) yields confidence NONE and zero tiles", async () => {
  const bytes = await buildSyntheticSinglePhoto();
  const result = await detectGridTiles(bytes);
  assert.equal(result.confidence, "NONE");
  assert.equal(result.tiles.length, 0);
});

test("a 2x4 grid is also recovered with the correct tile count", async () => {
  const { bytes } = await buildSyntheticGridScreenshot({ columns: 2, rows: 4, width: 240 });
  const result = await detectGridTiles(bytes);
  assert.notEqual(result.confidence, "NONE");
  assert.equal(result.tiles.length, 8);
});
