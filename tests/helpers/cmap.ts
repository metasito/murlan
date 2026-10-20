import fontverter from "fontverter";

/**
 * Codepoints mapped to a non-zero glyph by a font's cmap (format 4 and 12). Accepts TTF/OTF or WOFF2.
 * Any other subtable format throws rather than being skipped: an empty set would pass every caller by
 * covering nothing.
 */
export async function cmapCodepoints(bytes: Buffer): Promise<Set<number>> {
  const buf: Buffer = await fontverter.convert(bytes, "sfnt");
  let cmap: number | null = null;
  for (let i = 0; i < buf.readUInt16BE(4); i++) {
    const entry = 12 + i * 16;
    if (buf.toString("ascii", entry, entry + 4) === "cmap") cmap = buf.readUInt32BE(entry + 8);
  }
  if (cmap === null) throw new Error("the font has no cmap table");

  const covered = new Set<number>();
  for (let i = 0; i < buf.readUInt16BE(cmap + 2); i++) {
    const sub = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(sub);
    if (format === 4) format4(buf, sub, covered);
    else if (format === 12) format12(buf, sub, covered);
    else throw new Error(`cmap subtable format ${format} is not one this can read`);
  }
  return covered;
}

function format4(buf: Buffer, sub: number, covered: Set<number>): void {
  const segCount = buf.readUInt16BE(sub + 6) / 2;
  const endCodes = sub + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  for (let seg = 0; seg < segCount; seg++) {
    const end = buf.readUInt16BE(endCodes + seg * 2);
    const start = buf.readUInt16BE(startCodes + seg * 2);
    const delta = buf.readInt16BE(idDeltas + seg * 2);
    const rangeOffsetAt = idRangeOffsets + seg * 2;
    const rangeOffset = buf.readUInt16BE(rangeOffsetAt);
    for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
      let glyph = (cp + delta) & 0xffff;
      if (rangeOffset !== 0) {
        glyph = buf.readUInt16BE(rangeOffsetAt + rangeOffset + (cp - start) * 2);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) covered.add(cp);
    }
  }
}

function format12(buf: Buffer, sub: number, covered: Set<number>): void {
  const groups = buf.readUInt32BE(sub + 12);
  for (let g = 0; g < groups; g++) {
    const at = sub + 16 + g * 12;
    const [start, end, glyph] = [buf.readUInt32BE(at), buf.readUInt32BE(at + 4), buf.readUInt32BE(at + 8)];
    for (let cp = start; cp <= end; cp++) if (glyph + (cp - start) !== 0) covered.add(cp);
  }
}
