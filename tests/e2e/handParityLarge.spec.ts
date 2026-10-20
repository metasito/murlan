// The two larger phones of tests/e2e/helpers/handParity.ts.
import { test } from "./fixtures";
import { handTests } from "./helpers/handParity";
import { PHONES } from "./helpers/phones";

test.describe("the hand a player holds", () => {
  handTests(PHONES.slice(2));
});
