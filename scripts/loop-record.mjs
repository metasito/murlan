/**
 * A finished ticket as one line of `.loop-logs/tickets.jsonl`.
 *
 * Nothing in the loop reads this file back. It exists so the next question about the loop is
 * answered by a measurement rather than an estimate — which is how the decision to overlap the CI
 * wait was made, and how the prompt-cache flag will be judged.
 *
 * @param {{number: number, size: string|null, outcome: string, pr: number|null,
 *   phases: Record<string, number>, result: object|null, ci: object|null, reviewRounds: number,
 *   startedAt: string, version: string|null}} run
 */
export function row({ number, size, outcome, pr, phases, result, ci, reviewRounds, startedAt, version }) {
  const models = Object.fromEntries(
    Object.entries(result?.models ?? {}).map(([name, u]) => [name, u.costUSD ?? 0])
  );
  return {
    n: number,
    size: size ?? null,
    outcome,
    pr: pr ?? null,
    phases,
    cost: result?.cost ?? 0,
    turns: result?.turns ?? 0,
    models,
    subagents: result?.subagents ?? null,
    cache: result?.cache ?? { created: 0, read: 0 },
    ci: ci ?? null,
    review_rounds: reviewRounds,
    claude_version: version ?? null,
    started: startedAt,
  };
}
