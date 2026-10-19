/**
 * The next-round vote deadline the e2e server runs with. Every spec that reaches a round's end
 * without voting has to finish before it: tapTargetsVotes.spec.ts's sweep of the vote, the longest,
 * sits about 6 s on that screen.
 */
export const E2E_VOTE_DEADLINE_MS = 15_000;
