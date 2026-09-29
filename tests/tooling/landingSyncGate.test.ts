import { test } from "node:test";
import assert from "node:assert/strict";
import { GATES } from "../../scripts/diagnostics-verdict.mjs";

const LEAD = 12;
const contacts = Array.from({ length: 40 }, (_, i) => 1000 + i * 900);
const rows = (offsets: (number | null)[]) => [
  { k: "play", t: 0, id: "combo", at: 0, bus: "sfx", dropped: false, lead: LEAD },
  ...contacts.map((c) => ({ k: "trigger", t: c, name: "flightContact" })),
  ...contacts.flatMap((c, i) => (offsets[i] === null ? [] : [{ k: "onset", t: c - LEAD + offsets[i]!, db: -20, source: "app" }])),
];

test("onsets within a frame of contact pass", () => {
  const r = GATES.landingSync(rows(contacts.map((_, i) => ((i * 7) % 17) - 8)));
  assert.equal(r.pass, true);
  assert.equal(r.metrics.misses, 0);
});

test("onsets 30 ms late on a fifth of the landings fail", () => {
  assert.equal(GATES.landingSync(rows(contacts.map((_, i) => (i % 10 < 2 ? 30 : 2)))).pass, false);
});

test("a landing with no sound fails even when the rest are exact", () => {
  const r = GATES.landingSync(rows(contacts.map((_, i) => (i === 0 ? null : 0))));
  assert.equal(r.pass, false);
  assert.equal(r.metrics.misses, 1);
});

test("a sound that plays early by 25 ms fails: the gate is signed, not only late", () => {
  assert.equal(GATES.landingSync(rows(contacts.map(() => -25))).pass, false);
});

test("fewer than 40 landings is not a pass", () => {
  assert.equal(GATES.landingSync(rows(contacts.map(() => 0)).filter((r) => !(r.k === "trigger" && r.t > 30000))).pass, false);
});
