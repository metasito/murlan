// Every fixed real-time wait left in the server-side suites, counted exactly. A test waits on
// server time by installing a clock and advancing it, on an event or an ack by awaiting it, and on
// an absence with `nothingArrives`; real time is left only where real time is the subject.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixedWaits, readInventory, SCANNED, sources, WAIT_INVENTORY, widenedWindows } from "../helpers/waitInventory.ts";

/** Exact, not a ceiling: a wait removed goes red until its entry is lowered, so the list only shrinks. */
const { waits: INVENTORY, windows: WINDOWS } = readInventory();

const files = sources();
const counts = fixedWaits(files);

test("the suites are scanned at all", () => {
  for (const dir of SCANNED) {
    assert.ok(files.filter(([f]) => f.startsWith(`${dir}/`)).length > 10, `fewer than ten files under ${dir}: the walk no longer sees it`);
  }
  assert.ok(counts.size > 0, "no fixed wait found anywhere, which the inventory says is false");
});

test("every fixed real-time wait left is inventoried, at its exact count", () => {
  const found = Object.fromEntries([...counts].map(([file, lines]) => [file, lines.length]));
  const pinned = Object.fromEntries(Object.entries(INVENTORY).map(([file, { n }]) => [file, n]));
  assert.deepEqual(
    found,
    pinned,
    "Install a clock for server time, await the event or ack, or use nothingArrives for an absence. " +
      `A wait that is about real time itself is listed under "waits" in ${WAIT_INVENTORY} with its reason; ` +
      "a removed one is lowered by `npm run regen`. " +
      `Found: ${JSON.stringify([...counts].map(([file, lines]) => `${file}: ${lines.join(", ")}`))}`
  );
});

test("each inventoried wait says why it is real time", () => {
  for (const [file, { why }] of Object.entries(INVENTORY)) {
    assert.ok(why.split(/\s+/).length >= 6, `${file}: say why this wait is about real time`);
  }
});

test("every nothingArrives call that widens its window is inventoried, at its exact count", () => {
  assert.deepEqual(
    Object.fromEntries(widenedWindows(files)),
    Object.fromEntries(Object.entries(WINDOWS).map(([file, { n }]) => [file, n])),
    `A call site that passes \`ms\` to nothingArrives waits that long on every green run: list it under "windows" in ${WAIT_INVENTORY} with its reason, or drop the override; a removed one is lowered by \`npm run regen\`.`
  );
  for (const [file, { why }] of Object.entries(WINDOWS)) {
    assert.ok(why.split(/\s+/).length >= 6, `${file}: say why this window is wider than the default`);
  }
});
