// The table's one float, as the game moves under it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nextFloat, raised, type FloatInput } from "../../components/table/floatModel.ts";

const LABELS = { passed: "PASSED", autoPass: "AUTO-PASS" };
const quiet: FloatInput = { withdrawn: false };

describe("nextFloat", () => {
  test("pass, then the auto-pass notice, then a withdrawal: one float re-titled, then silenced", () => {
    const passed = nextFloat(null, { ...quiet, viewerPassed: true }, LABELS);
    assert.deepEqual(passed, { id: 1, kind: "pass", text: "PASSED", live: true });

    const auto = nextFloat(passed, { ...quiet, autoPassed: true }, LABELS);
    assert.deepEqual(auto, { id: 1, kind: "autoPass", text: "AUTO-PASS", live: true });

    const withdrawn = nextFloat(auto, { withdrawn: true, withdrew: true }, LABELS);
    assert.deepEqual(withdrawn, { id: 1, kind: "autoPass", text: "AUTO-PASS", live: false });
  });

  test("nothing changing returns the float standing, by identity", () => {
    const standing = raised(null, "pass", "PASSED");
    assert.equal(nextFloat(standing, quiet, LABELS), standing);
    assert.equal(nextFloat(null, quiet, LABELS), null);
  });

  test("a move that is not the viewer's pass silences a live float without replacing it", () => {
    const standing = raised(null, "toast", "nope");
    assert.deepEqual(nextFloat(standing, { ...quiet, viewerPassed: false }, LABELS), { ...standing, live: false });
  });

  test("an auto-pass notice re-titles only a live pass", () => {
    const toast = raised(null, "toast", "nope");
    assert.equal(nextFloat(toast, { ...quiet, autoPassed: true }, LABELS), toast);
    const silenced = { ...raised(null, "pass", "PASSED"), live: false };
    assert.equal(nextFloat(silenced, { ...quiet, autoPassed: true }, LABELS), silenced);
  });

  test("an error raises a toast; its clearing silences only a toast", () => {
    const toast = nextFloat(null, { ...quiet, error: { text: "nope" } }, LABELS);
    assert.deepEqual(toast, { id: 1, kind: "toast", text: "nope", live: true });
    assert.deepEqual(nextFloat(toast, { ...quiet, error: null }, LABELS), { ...toast, live: false });
    const pass = raised(toast, "pass", "PASSED");
    assert.equal(nextFloat(pass, { ...quiet, error: null }, LABELS), pass);
  });

  test("a float raised while the table is withdrawn is born silent", () => {
    assert.equal(nextFloat(null, { withdrawn: true, viewerPassed: true }, LABELS)?.live, false);
    assert.equal(nextFloat(null, { withdrawn: true, error: { text: "nope" } }, LABELS)?.live, false);
  });

  test("a pass and an error in one commit: the error is the float, a new life after the pass", () => {
    const both = nextFloat(null, { ...quiet, viewerPassed: true, error: { text: "nope" } }, LABELS);
    assert.deepEqual(both, { id: 2, kind: "toast", text: "nope", live: true });
  });
});
