// node tests/differential/trace.ts <tree-root> [--seeds 1-150] [--tables 2,3,4,4-teams]
// Plays seeded all-bot matches on the tree at <tree-root> and writes one JSON line per match
// (round level) and, when that tree's `simulateOfflineMatch` offers `onTransition`, one per
// committed state. `compare.ts` diffs two of these; docs/agents/checks.md has the workflow.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { teamForSeat, type GameMode, type GameState } from "../../lib/game/gameEngine.ts";
import { mulberry32 } from "../support/game.ts";

export const TABLES: Record<string, { seats: number; gameMode: GameMode }> = {
  "2": { seats: 2, gameMode: "free_for_all" },
  "3": { seats: 3, gameMode: "free_for_all" },
  "4": { seats: 4, gameMode: "free_for_all" },
  "4-teams": { seats: 4, gameMode: "teams" },
};

export type TraceLine =
  | { level: "match"; table: string; seed: number; rounds: unknown[]; winners: string[]; isDraw: boolean }
  | { level: "match"; table: string; seed: number; error: string }
  | {
      level: "transition";
      table: string;
      seed: number;
      round: number;
      seq: number;
      kind: string;
      seat: number | null;
      cardIds: string[];
      handCounts: number[];
      currentTurnIndex: number;
    };

function transition(table: string, seed: number, round: number, seq: number, prev: GameState | null, next: GameState) {
  const fresh = prev === null || prev.roundOver;
  const moved = fresh || prev.lastMove?.seq !== next.lastMove?.seq;
  const last = next.lastMove as { kind: string; seat?: number } | undefined;
  const cardIds = fresh
    ? []
    : prev.players.flatMap((p, i) => {
        const kept = new Set(next.players[i].hand.map((c) => c.id));
        return p.hand.filter((c) => !kept.has(c.id)).map((c) => c.id);
      });
  return {
    level: "transition" as const,
    table,
    seed,
    round,
    seq,
    kind: fresh ? "deal" : moved ? (last?.kind ?? "move") : "exchange",
    seat: fresh || !moved ? null : (last?.seat ?? null),
    cardIds: cardIds.sort(),
    handCounts: next.players.map((p) => p.hand.length),
    currentTurnIndex: next.currentTurnIndex,
  };
}

type Simulate = (opts: any) => any;

export async function loadSimulator(root: string): Promise<Simulate> {
  const url = pathToFileURL(path.join(path.resolve(root), "tests", "helpers", "offlineMatch.ts")).href;
  return (await import(url)).simulateOfflineMatch;
}

export function traceTree(simulateOfflineMatch: Simulate, seeds: number[], tables: string[]): TraceLine[] {
  const out: TraceLine[] = [];
  for (const table of tables) {
    const { seats, gameMode } = TABLES[table];
    const players = Array.from({ length: seats }, (_, i) => ({
      name: `Bot${i}`,
      type: "bot",
      team: teamForSeat(i, seats, gameMode),
    }));
    for (const seed of seeds) {
      const transitions: TraceLine[] = [];
      let round = -1;
      let seq = 0;
      const onTransition = (prev: GameState | null, next: GameState) => {
        if (prev === null || prev.roundOver) {
          round++;
          seq = 0;
        }
        transitions.push(transition(table, seed, round, seq++, prev, next));
      };
      try {
        const r = simulateOfflineMatch({
          seed,
          players,
          gameMode,
          length: "match",
          botRng: (s: number) => mulberry32(s + 1),
          onTransition,
        });
        out.push({
          level: "match",
          table,
          seed,
          rounds: r.rounds.map((x: Record<string, unknown>) => ({
            finishingOrder: x.finishingOrder,
            moves: x.moves,
            target: x.target,
            cumulativeAfter: x.cumulativeAfter,
          })),
          winners: r.winners,
          isDraw: r.isDraw,
        });
      } catch (e) {
        const err = e as Error;
        out.push({ level: "match", table, seed, error: `${err.name}: ${err.message}` });
      }
      out.push(...transitions);
    }
  }
  return out;
}

function parseRange(spec: string): number[] {
  return spec.split(",").flatMap((part) => {
    const [a, b = a] = part.split("-").map(Number);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : args[i + 1];
  };
  const root = args[0];
  const tables = flag("--tables", Object.keys(TABLES).join(",")).split(",");
  const unknown = tables.filter((t) => !(t in TABLES));
  if (!root || unknown.length > 0) {
    console.error(`usage: trace.ts <tree-root> [--seeds 1-150] [--tables ${Object.keys(TABLES).join(",")}]`);
    process.exit(2);
  }
  let simulate: Simulate;
  try {
    simulate = await loadSimulator(root);
  } catch (e) {
    // git bisect run reads 125 as "this commit cannot be tested": skip it.
    console.error(e);
    process.exit(125);
  }
  const lines = traceTree(simulate, parseRange(flag("--seeds", "1-150")), tables);
  process.stdout.write(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}
