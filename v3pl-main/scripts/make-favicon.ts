/**
 * Renders src/app/icon.svg to src/app/apple-icon.png (180×180) and src/app/favicon.ico (PNG-in-ICO, 32×32 + 16×16)
 * so tabs, bookmarks and iOS home screens all show the same icon. Re-run after changing icon.svg:
 *   npx tsx scripts/make-favicon.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("src/app/icon.svg");

/** Wraps PNG images in an ICO container (PNG entries are valid ICO payloads in every modern browser). */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * pngs.length;
  for (const p of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(p.size === 256 ? 0 : p.size, 0);
    e.writeUInt8(p.size === 256 ? 0 : p.size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(p.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += p.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

async function main() {
  const png = (size: number) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
  writeFileSync("src/app/apple-icon.png", await png(180));
  writeFileSync("src/app/favicon.ico", ico([{ size: 32, data: await png(32) }, { size: 16, data: await png(16) }]));
  console.log("wrote src/app/apple-icon.png and src/app/favicon.ico");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
