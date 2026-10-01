import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, inflateRawSync } from "node:zlib";
import { gateTable, waitForRunEnd } from "../../scripts/bench-gates.mjs";
import { GATES } from "../../scripts/diagnostics-verdict.mjs";
import { patchBenchHost, withBenchHost } from "../../scripts/ios-device.mjs";
import { benchLaunchHref } from "../../lib/diagnostics/benchLaunch.ts";

const RELEASE = { k: "build", t: 0, dev: false, scriptURL: "file:///var/x/murlan.app/main.jsbundle" };
const ran = (name: string) => [
  { session: "s", k: "scenario", t: 0, name, phase: "start" },
  { session: "s", k: "scenario", t: 1, name, phase: "end", error: null },
];

test("the wait returns only once the bench's run-end row has landed", async () => {
  const reads = [
    [{ k: "run", phase: "start", names: ["idle"] }],
    [{ k: "run", phase: "start", names: ["idle"] }, { k: "run", phase: "end", names: ["idle"] }],
  ];
  let calls = 0;
  const end = await waitForRunEnd(() => reads[Math.min(calls++, 1)], { pollMs: 0, timeoutMs: 1000 });
  assert.equal(calls, 2);
  assert.deepEqual(end, { names: ["idle"], timedOut: false });
  const never = await waitForRunEnd(() => reads[0], { pollMs: 0, timeoutMs: 5 });
  assert.deepEqual(never, { names: ["idle"], timedOut: true });
});

test("a scenario the run named but no rows judge is missing, and fails the table", () => {
  const rows = [{ session: "s", ...RELEASE }, ...ran("idle")];
  const { pass, markdown } = gateTable(rows, ["idle", "noticeGallery"]);
  assert.equal(pass, false);
  assert.match(markdown, /\| noticeGallery \| missing \|/);
  assert.match(markdown, /\| idle \| (fail|pass) \|/);
  assert.equal(gateTable(rows, []).pass, false);
});

test("a bench build starts the run at launch only when the install carried the PC's address", () => {
  assert.equal(benchLaunchHref({ benchHost: "192.168.1.23" }), "/bench?host=192.168.1.23&scenario=all");
  assert.equal(benchLaunchHref(undefined), null);
  assert.equal(benchLaunchHref({}), null);
  assert.equal(benchLaunchHref({ benchHost: "evil.example/x?" }), null);
  const config = JSON.parse(withBenchHost(JSON.stringify({ name: "Murlan", extra: { router: {} } }), "10.0.0.7"));
  assert.deepEqual(config, { name: "Murlan", extra: { router: {}, benchHost: "10.0.0.7" } });
});

test("the table judges every gate the PC knows, whatever subset the phone ran", () => {
  const { pass, markdown } = gateTable([{ session: "s", ...RELEASE }, ...ran("idle")], ["idle"]);
  assert.equal(pass, false);
  for (const name of Object.keys(GATES)) assert.match(markdown, new RegExp(`\\| ${name} \\|`));
  assert.match(markdown, /\| noticeGallery \| missing \|/);
});

test("an unrun verdict, from a dev build, fails the table", () => {
  const { pass, markdown } = gateTable([{ session: "s", ...RELEASE, dev: true }, ...ran("idle")], ["idle"]);
  assert.equal(pass, false);
  assert.match(markdown, /\| idle \| unrun \|/);
});

function storedZip(files: { name: string; text: string; mode: number }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, text, mode } of files) {
    const body = Buffer.from(text, "utf8");
    const n = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(body), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(n.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(0x031e, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt32LE(crc32(body), 16);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(body.length, 24);
    head.writeUInt16LE(n.length, 28);
    head.writeUInt32LE((mode << 16) >>> 0, 38);
    head.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    central.push(head, n);
    offset += 30 + n.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

type Entry = { mode: number; madeBy: number; text: string };
function entries(zip: Buffer): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  for (let at = zip.readUInt32LE(eocd + 16), i = 0; i < zip.readUInt16LE(eocd + 10); i++) {
    const nameLen = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + zip.readUInt32LE(at + 20));
    out[zip.toString("utf8", at + 46, at + 46 + nameLen)] = {
      mode: zip.readUInt32LE(at + 38) >>> 16,
      madeBy: zip.readUInt16LE(at + 4),
      text: (zip.readUInt16LE(at + 10) === 8 ? inflateRawSync(data) : data).toString("utf8"),
    };
    at += 46 + nameLen + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return out;
}

test("the address is written into the IPA's app.config, every other entry and every mode kept", () => {
  const ipa = path.join(mkdtempSync(path.join(tmpdir(), "murlan-ipa-")), "bench.ipa");
  const config = "Payload/Murlan.app/EXConstants.bundle/app.config";
  const binary = "Payload/Murlan.app/Murlan";
  const bundle = "Payload/Murlan.app/main.jsbundle";
  writeFileSync(
    ipa,
    storedZip([
      { name: binary, text: "\u0000binary", mode: 0o100755 },
      { name: config, text: JSON.stringify({ name: "Murlan", description: "Lojë me letra" }), mode: 0o100644 },
      { name: bundle, text: "bundle", mode: 0o100644 },
    ])
  );
  patchBenchHost(ipa, "192.168.1.9");
  patchBenchHost(ipa, "192.168.1.10");
  const after = entries(readFileSync(ipa));
  assert.deepEqual(JSON.parse(after[config].text), { name: "Murlan", description: "Lojë me letra", extra: { benchHost: "192.168.1.10" } });
  assert.deepEqual(Object.keys(after).sort(), [binary, config, bundle].sort());
  assert.deepEqual([after[binary].mode, after[config].mode, after[bundle].mode], [0o100755, 0o100644, 0o100644]);
  assert.ok(Object.values(after).every((e) => e.madeBy === 0x031e));
  assert.equal(after[binary].text, "\u0000binary");
});

test("a second bench run's postTo keeps the rows the first run has not posted yet", async () => {
  const posted: { rows: { k: string }[] }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    posted.push(JSON.parse(init.body));
    return new Response("ok");
  }) as unknown as typeof fetch;
  try {
    const { recorder } = await import("../../lib/diagnostics/recorder.ts");
    recorder.postTo("10.0.0.1");
    recorder.push({ k: "run", t: 0, phase: "end", names: [] });
    recorder.postTo("10.0.0.1");
    await new Promise((r) => setTimeout(r, 1200));
    assert.deepEqual(posted.flatMap((b) => b.rows.map((r) => r.k)), ["run"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
