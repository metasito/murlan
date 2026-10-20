// The two smaller phones of tests/e2e/helpers/handParity.ts, and the hand coming closer on turn.
import { test } from "./fixtures";
import { handTests, nearerOnOwnTurnTest } from "./helpers/handParity";
import { PHONES } from "./helpers/phones";

test.describe("the hand a player holds", () => {
  handTests(PHONES.slice(0, 2));
  nearerOnOwnTurnTest();
});
