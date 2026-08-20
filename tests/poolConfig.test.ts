// tests/poolConfig.test.ts — the one env knob on the connection pool.
//
// `MURLAN_PG_POOL_MAX` is set per environment: 10 deployed, a small number per
// process for the integration suites (tests/helpers/testServer.ts). A value pg
// cannot use has to be refused where it is read, because `new Pool({ max: NaN })`
// surfaces much later as a connection failure with nothing pointing back here.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolvePoolMax } from "../server/db.ts";

describe("resolvePoolMax", () => {
  test("unset, or empty, is the deployed default", () => {
    assert.equal(resolvePoolMax(undefined), 10);
    assert.equal(resolvePoolMax(""), 10);
    assert.equal(resolvePoolMax("   "), 10);
  });

  test("a positive integer is taken as given", () => {
    assert.equal(resolvePoolMax("4"), 4);
    assert.equal(resolvePoolMax("1"), 1);
  });

  test("anything pg cannot use is refused, not passed through", () => {
    for (const raw of ["many", "4.5", "0", "-2", "1e3x", "NaN"]) {
      assert.throws(
        () => resolvePoolMax(raw),
        /MURLAN_PG_POOL_MAX/,
        `${JSON.stringify(raw)} must not reach the pool`
      );
    }
  });
});
