import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { buildPage, CHART_FIELDS, findMoments } from "../../scripts/mockupParityPage.mjs";

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

test("the page spans the longer side, and every chart marks the failures of its own field", () => {
  const dir = scratch();
  const failure = (field: string, t: number) => ({ field, t, mockup: null, app: null, message: field });
  const m = { ...parity(), failures: [failure("moth", 8000), failure("air", 15968)] };
  m.sides.app.trace.frames.push({ t: 15968, onsets: [], live: 1, dropped: 0, lamp: null, shake: null });
  fs.mkdirSync(path.join(dir, "rest", "frames"), { recursive: true });
  fs.writeFileSync(path.join(dir, "rest", "parity.json"), JSON.stringify(m));
  for (const [name, jpeg] of Object.entries(JPEGS)) fs.writeFileSync(path.join(dir, "rest", "frames", `${name}-00000.jpg`), jpeg);
  const page = fs.readFileSync(buildPage(findMoments(dir), path.join(dir, "out")), "utf8");

  const node = () => ({ innerHTML: "", value: 0, textContent: "", src: "", dataset: {}, querySelector: node, querySelectorAll: () => [], append() {} });
  const root = { section: node(), append(s: ReturnType<typeof node>) { this.section = s; } };
  const document = { createElement: node, getElementById: () => root };
  vm.runInNewContext(page.match(/<script>([\s\S]*)<\/script>/)![1], { document });
  const html = root.section.innerHTML;
  assert.match(html, /type="range" min="0" max="15968"/);
  const marked = (chart: string) => /stroke="#e5484d"/.test(html.split(`>${chart} (`)[1].split("</svg>")[0]);
  assert.equal(marked("moth x"), true, "the moth x chart marks the moth's failure");
  assert.equal(marked("motes"), true, "the motes chart marks the air's failure");
  assert.equal(marked("live"), false);
  const series = page.match(/const SERIES = \{([\s\S]*?)\n {2}\};/)![1];
  const charts = [...series.matchAll(/(?:"([^"]+)"|(\w+)): \(f\) =>/g)].map((c) => c[1] ?? c[2]);
  assert.deepEqual(charts.sort(), Object.keys(CHART_FIELDS).sort());
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
