// lib/e2eAiSuspend.ts — holding a seeded table still for a capture.
//
// `lib/captureStates.ts` seeds a turn and says so itself: "Nothing here
// advances the turn on its own." But app/game.tsx runs the offline AI turn
// loop regardless of how the table was reached, so a capture-state save is a
// bot's turn for about a second before the loop moves off the seat the state
// was named for (docs/agents/loops.md). This is the runtime signal that
// actually holds it: written to `window.localStorage` by
// `tests/e2e/helpers/offlineSeed.ts` before `/game` loads, and read by
// app/game.tsx's AI scheduling effect.
//
// `e2eFast` is the existing build-time gate (`EXPO_PUBLIC_E2E_FAST`, inlined
// at bundle build time, never set outside a build the e2e harness itself
// produces) rather than a second one: a stray flag value left in a browser
// profile or a hand-edited blob cannot suspend a real game, because the branch
// that reads it does not exist in a dev or production build at all.
export const E2E_SUSPEND_AI_KEY = "@murlan_e2e_suspend_ai";

export function shouldSuspendAI(e2eFast: boolean, flag: string | null): boolean {
  return e2eFast && flag === "1";
}
