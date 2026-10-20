// Which of the table's layers each reason to withdraw it reaches.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tableVeils, type VeilRole } from "../../components/table/tableVeils.ts";

const NONE = { settingsOpen: false, tableCovered: false, portrait: false, holdingForStart: false };
const veiled = (reason: Partial<typeof NONE>) => {
  const { veil } = tableVeils({ ...NONE, ...reason });
  return (Object.keys(veil) as VeilRole[]).filter((role) => veil[role]).sort();
};

describe("tableVeils", () => {
  test("nothing withdraws an open table", () => {
    assert.deepEqual(veiled({}), []);
    assert.equal(tableVeils(NONE).withdrawn, false);
  });

  test("each reason, alone", () => {
    assert.deepEqual(veiled({ settingsOpen: true }), ["clock", "sheet", "sheetOnly", "table"]);
    assert.deepEqual(veiled({ tableCovered: true }), ["clock", "coverOnly", "table"]);
    assert.deepEqual(veiled({ portrait: true }), ["clock", "coverOnly", "sheetOnly", "table"]);
    assert.deepEqual(veiled({ holdingForStart: true }), ["coverOnly", "table"]);
  });

  test("the sheet open over a cover leaves the rail reachable, since its knob closes the sheet", () => {
    assert.deepEqual(veiled({ settingsOpen: true, tableCovered: true }), ["clock", "sheet", "sheetOnly", "table"]);
    assert.deepEqual(veiled({ settingsOpen: true, holdingForStart: true }), ["clock", "sheet", "sheetOnly", "table"]);
  });

  test("the table is withdrawn exactly when any reason holds", () => {
    for (let n = 0; n < 16; n++) {
      const reason = {
        settingsOpen: (n & 1) > 0,
        tableCovered: (n & 2) > 0,
        portrait: (n & 4) > 0,
        holdingForStart: (n & 8) > 0,
      };
      const { withdrawn, veil } = tableVeils(reason);
      assert.equal(withdrawn, n > 0);
      assert.equal(veil.table, withdrawn);
    }
  });
});
