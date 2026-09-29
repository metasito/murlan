// The landing's pulses are `runLandingPulses`' on the contact frame; a haptic in its cue would double them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cueFor } from "../../lib/device/moments.ts";

test("a landing's cue carries no haptic, for any size, bomb or not, the viewer's or not", () => {
  for (const cards of [1, 2, 3, 4, 5])
    for (const bomb of [false, true])
      for (const mine of [false, true])
        assert.deepEqual(cueFor({ kind: "landing", cards, bomb, mine }).haptics, [], `${cards} ${bomb} ${mine}`);
});
