import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
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

test("the page spans the longer side, and every chart marks the failures of its own field", () => {
  const fieldOf: Record<string, string> = {
    live: "live", dropped: "dropped", motes: "air", "moth x": "moth", "lamp x": "lamp", "lamp y": "lamp",
    level: "level", flare: "flare", shake: "shake", scorePill: "scorePill", grey: "grey", "lamp phase": "freeze",
  };
  const run = (field: string) => {
    const dir = scratch();
    const m = { ...parity(), failures: [{ field, t: 8000, mockup: null, app: null, message: field }] };
    m.sides.app.trace.frames.push({ t: 15968, onsets: [], live: 1, dropped: 0, lamp: null, shake: null });
    m.sides.mockup.frames.push({ t: 1440, file: "frames/mockup-00000.jpg", sha1: sha1(JPEGS.mockup) });
    fs.mkdirSync(path.join(dir, "rest", "frames"), { recursive: true });
    fs.writeFileSync(path.join(dir, "rest", "parity.json"), JSON.stringify(m));
    for (const [name, jpeg] of Object.entries(JPEGS)) fs.writeFileSync(path.join(dir, "rest", "frames", `${name}-00000.jpg`), jpeg);
    const page = fs.readFileSync(buildPage(findMoments(dir), path.join(dir, "out")), "utf8");
    const node = () => ({ innerHTML: "", value: 0, textContent: "", src: "", dataset: {}, querySelector: node, querySelectorAll: () => [], append() {} });
    const root = { section: node(), append(s: ReturnType<typeof node>) { this.section = s; } };
    vm.runInNewContext(page.match(/<script>([\s\S]*)<\/script>/)![1], { document: { createElement: node, getElementById: () => root } });
    return { page, html: root.section.innerHTML };
  };

  const { page, html } = run("moth");
  assert.match(html, /type="range" min="0" max="15968" step="16"/);
  const series = page.match(/const SERIES = \{([\s\S]*?)\n {2}\};/)![1];
  const charts = [...series.matchAll(/(?:"([^"]+)"|(\w+)): \(f\) =>/g)].map((c) => c[1] ?? c[2]);
  assert.deepEqual(charts.sort(), Object.keys(fieldOf).sort());
  for (const field of new Set(Object.values(fieldOf))) {
    const { html } = run(field);
    const marked = charts.filter((chart) => /stroke="#e5484d"/.test(html.split(`>${chart} (`)[1].split("</svg>")[0]));
    assert.deepEqual(marked.sort(), charts.filter((c) => fieldOf[c] === field).sort(), `the charts marking a ${field} failure`);
  }
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
