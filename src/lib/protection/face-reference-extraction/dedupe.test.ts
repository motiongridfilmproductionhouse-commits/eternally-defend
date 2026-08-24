import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { computePerceptualHash, hammingDistance } from "./dedupe.server";

async function solidImage(r: number, g: number, b: number, size = 64): Promise<Uint8Array> {
  const buf = Buffer.alloc(size * size * 3);
  for (let i = 0; i < buf.length; i += 3) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
  }
  const bytes = await sharp(buf, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  return new Uint8Array(bytes);
}

async function noiseImage(seed: number, size = 64): Promise<Uint8Array> {
  const buf = Buffer.alloc(size * size * 3);
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(rand() * 255);
  const bytes = await sharp(buf, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  return new Uint8Array(bytes);
}

test("identical images hash to zero hamming distance", async () => {
  const img = await noiseImage(1);
  const hashA = await computePerceptualHash(img);
  const hashB = await computePerceptualHash(img);
  assert.equal(hammingDistance(hashA, hashB), 0);
});

test("a re-encoded (slightly re-compressed) copy of the same image stays close in hamming distance", async () => {
  const original = await noiseImage(2);
  const recompressed = new Uint8Array(
    await sharp(Buffer.from(original)).jpeg({ quality: 80 }).toBuffer(),
  );
  const hashA = await computePerceptualHash(original);
  const hashB = await computePerceptualHash(recompressed);
  assert.ok(
    hammingDistance(hashA, hashB) <= 10,
    "re-encoded copy should stay within the dedupe prefilter threshold",
  );
});

test("visually distinct images hash far apart", async () => {
  const black = await solidImage(10, 10, 10);
  const white = await solidImage(245, 245, 245);
  const hashA = await computePerceptualHash(black);
  const hashB = await computePerceptualHash(white);
  assert.ok(
    hammingDistance(hashA, hashB) > 10,
    "distinct images should exceed the dedupe prefilter threshold",
  );
});
