import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildPage, findMoments } from "../../scripts/mockupParityPage.mjs";

const JPEGS = { mockup: Buffer.from("mockup-frame"), app: Buffer.from("app-frame") };
const sha1 = (b: Buffer) => createHash("sha1").update(b).digest("hex");

function parity() {
  const side = (name: "mockup" | "app") => ({
    trace: { frames: [{ t: 0, onsets: [], live: 1, dropped: 0, lamp: null, shake: null }], regions: [] },
    frames: [{ t: 0, file: `frames/${name}-00000.jpg`, sha1: sha1(JPEGS[name]) }],
  });
  return { murlanParity: 1, moment: "rest", mode: "determinism", stepMs: 16, checkpoints: [0], sides: { mockup: side("mockup"), app: side("app") }, failures: [] };
}

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "parity-page-"));
}

test("builds the page from a local run's bundle", () => {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, "rest", "frames"), { recursive: true });
  fs.writeFileSync(path.join(dir, "rest", "parity.json"), JSON.stringify(parity()));
  for (const [name, jpeg] of Object.entries(JPEGS)) fs.writeFileSync(path.join(dir, "rest", "frames", `${name}-00000.jpg`), jpeg);
  const out = path.join(dir, "out");
  const page = fs.readFileSync(buildPage(findMoments(dir), out), "utf8");
  assert.match(page, /"moment":"rest"/);
  assert.deepEqual(fs.readFileSync(path.join(out, "rest", "app-00000.jpg")), JPEGS.app);
});

test("finds the frames of a Playwright report by their content", () => {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", "0a1b.json"), JSON.stringify(parity()));
  for (const jpeg of Object.values(JPEGS)) fs.writeFileSync(path.join(dir, "data", `${sha1(jpeg)}.jpg`), jpeg);
  const [m] = findMoments(dir);
  assert.equal(fs.readFileSync(m.sides.mockup.frames[0].source).toString(), "mockup-frame");
});

test("refuses a report missing a frame, and an input with no moment", () => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify(parity()));
  assert.throws(() => findMoments(dir), /no file for frames\/mockup-00000\.jpg/);
  assert.throws(() => findMoments(scratch()), /no parity\.json/);
});
