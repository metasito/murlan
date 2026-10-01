// Rewrites one entry of a zip in place of .NET's ZipArchive, which re-stamps every entry as made by FAT and drops its Unix mode.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

function centralDirectory(zip) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd === -1) throw new Error("not a zip: no end of central directory");
  const count = zip.readUInt16LE(eocd + 10);
  const start = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || start === 0xffffffff) throw new Error("zip64 is not supported");
  const entries = [];
  for (let at = start, i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad central directory header at ${at}`);
    const size = 46 + zip.readUInt16LE(at + 28) + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    entries.push({ header: Buffer.from(zip.subarray(at, at + size)), name: zip.toString("utf8", at + 46, at + 46 + zip.readUInt16LE(at + 28)) });
    at += size;
  }
  return { entries, start, eocd };
}

export function rewriteZipText(zip, match, edit) {
  const { entries, start, eocd } = centralDirectory(zip);
  const offsets = entries.map((e) => e.header.readUInt32LE(42));
  const ends = offsets.map((o) => offsets.filter((x) => x > o).reduce((a, b) => Math.min(a, b), start));
  const parts = [];
  const edited = [];
  let out = 0;
  entries.forEach((entry, i) => {
    const local = offsets[i];
    const nameLen = zip.readUInt16LE(local + 26);
    const dataAt = local + 30 + nameLen + zip.readUInt16LE(local + 28);
    const method = entry.header.readUInt16LE(10);
    entry.header.writeUInt32LE(out, 42);
    if (!match(entry.name)) {
      parts.push(zip.subarray(local, ends[i]));
      out += ends[i] - local;
      return;
    }
    if (method !== 0 && method !== 8) throw new Error(`${entry.name}: compression method ${method} is not supported`);
    const raw = zip.subarray(dataAt, dataAt + entry.header.readUInt32LE(20));
    edited.push(entry.name);
    const body = Buffer.from(edit((method === 8 ? inflateRawSync(raw) : raw).toString("utf8")), "utf8");
    const packed = deflateRawSync(body);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(entry.header.readUInt16LE(6), 4);
    head.writeUInt16LE(entry.header.readUInt16LE(8) & ~0x8, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(entry.header.readUInt32LE(12), 10);
    head.writeUInt32LE(crc32(body), 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(body.length, 22);
    head.writeUInt16LE(nameLen, 26);
    entry.header.writeUInt16LE(entry.header.readUInt16LE(8) & ~0x8, 8);
    entry.header.writeUInt16LE(8, 10);
    entry.header.writeUInt32LE(crc32(body), 16);
    entry.header.writeUInt32LE(packed.length, 20);
    entry.header.writeUInt32LE(body.length, 24);
    const name = zip.subarray(local + 30, local + 30 + nameLen);
    parts.push(head, name, packed);
    out += 30 + nameLen + packed.length;
  });
  const directory = Buffer.concat(entries.map((e) => e.header));
  const tail = Buffer.from(zip.subarray(eocd));
  tail.writeUInt32LE(directory.length, 12);
  tail.writeUInt32LE(out, 16);
  return { zip: Buffer.concat([...parts, directory, tail]), edited };
}
