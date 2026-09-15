#!/usr/bin/env node
// Turns the raw frames dumped by scripts/render-docs.ps1 into an animated gif.
//
//   node scripts/build-gif.mjs
//
// The frames are BGRA because that is what System.Drawing hands over.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import gifenc from "gifenc";

const { GIFEncoder, applyPalette, quantize } = gifenc;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const framesDir = join(root, "docs", "frames");
const name = process.argv[2] ?? "typing";
const metaPath = join(framesDir, `${name}.json`);
const dataPath = join(framesDir, `${name}.frames`);

if (!existsSync(metaPath) || !existsSync(dataPath)) {
  console.error(`missing ${metaPath} or ${dataPath}; run scripts/render-docs.ps1 first`);
  process.exit(1);
}

const meta = JSON.parse(readFileSync(metaPath, "utf8"));
const raw = readFileSync(dataPath);
const { width, height, frames, delayMs } = meta;
const frameBytes = width * height * 4;

if (raw.length !== frameBytes * frames) {
  console.error(`expected ${frameBytes * frames} bytes, found ${raw.length}`);
  process.exit(1);
}

const gif = GIFEncoder();

for (let index = 0; index < frames; index++) {
  const slice = raw.subarray(index * frameBytes, (index + 1) * frameBytes);

  // BGRA -> RGBA, and force full alpha: the canvas already has the backdrop.
  const rgba = new Uint8ClampedArray(frameBytes);
  for (let offset = 0; offset < frameBytes; offset += 4) {
    rgba[offset] = slice[offset + 2];
    rgba[offset + 1] = slice[offset + 1];
    rgba[offset + 2] = slice[offset];
    rgba[offset + 3] = 255;
  }

  const palette = quantize(rgba, 256);
  const indexed = applyPalette(rgba, palette);

  gif.writeFrame(indexed, width, height, {
    palette,
    delay: delayMs,
    // Paint over the previous frame: the canvas background is opaque anyway.
    dispose: 2,
  });
}

gif.finish();

const outPath = join(root, "docs", `${name}.gif`);
writeFileSync(outPath, gif.bytes());
const size = (readFileSync(outPath).length / 1024).toFixed(0);
console.log(`${outPath}: ${frames} frames, ${width}x${height}, ${delayMs}ms, ${size} KB`);
