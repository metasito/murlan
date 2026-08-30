// tests/soak/soak.ts — something finally plays Murlan.
//
// Every product defect this project has fixed was found by the owner playing
// the game and describing what went wrong. The suites are all scripted: each
// one asserts a value somebody wrote down, so none of them can fail in a way
// nobody thought of. This does the opposite — it plays real hands through real
// sockets against real Postgres, breaks the connections while it does, and
// checks only that the clients and the server still agree with each other.
//
// Run: npm run soak -- --seats 4 --minutes 2 --seed 12345
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import type { Socket } from "socket.io-client";
import { startTestServer, hasDatabase, type TestServer } from "../helpers/testServer.ts";
import { connectAs, reconnectWith, DEADLINE_SCALE } from "../helpers/client.ts";
import { createDeck, getAllValidPlays, type Card, type Combination } from "../../lib/gameEngine.ts";
import { checkAll, type SeatView, type Violation } from "./invariants.ts";

interface SanitizedPlayer {
  name: string;
  hand: Card[];
  handCount: number;
}

interface TableState {
  players: SanitizedPlayer[];
  currentTurnIndex: number;
  lastPlayedCombination: Combination | null;
  gameOver: boolean;
  firstPlayMade: boolean;
  startCard?: Card;
  exchangePhase?: { active: boolean; winnerIdx: number; cardFromLoser?: Card };
  /** `null` once this account holds no seat — the server's own "not seated". */
  viewerSeatIndex: number | null;
}

interface RoomState {
  roomId: string;
  code: string;
  status: string;
}

/**
 * A deterministic generator, so a failure can be replayed. `Math.random` would
 * make every interesting run unrepeatable, which is most of the value gone.
 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * How long a reconnecting client may wait for the table. Generous: the rejoin
 * path reads the room, may rehydrate the game from Postgres, and re-seats the
 * socket before it answers.
 */
const REJOIN_BUDGET_MS = 5_000 * DEADLINE_SCALE;

/**
 * What arrives instead of a table. `game:rejoin_failed` carries the rejoin
 * path's own refusals; the generic one is what `onEvent` sends when the packet
 * never reaches the handler at all — rate limited, or malformed. Listening to
 * both is what lets an unanswered rejoin name its cause instead of guessing.
 */
export const REFUSAL_EVENTS = ["game:rejoin_failed", "game:error"] as const;

interface Options {
  seats: number;
  minutes: number;
  seed: number;
  /** Chance per move taken that the chaos driver does something. */
  chaos: number;
}

function parseArgs(argv: string[]): Options {
  const read = (name: string, fallback: number) => {
    const at = argv.indexOf(`--${name}`);
    if (at === -1) return fallback;
    const value = Number(argv[at + 1]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    seats: Math.max(2, Math.min(4, read("seats", 4))),
    minutes: read("minutes", 2),
    seed: read("seed", Math.floor(Math.random() * 1e9)),
    chaos: read("chaos", 0.05),
  };
}

/** One virtual player: a real socket, its own view, and legal moves only. */
class Seat {
  socket: Socket;
  readonly username: string;
  readonly userId: string;
  readonly cookie: string;
  state: TableState | null = null;
  /** Bumped on every `game:state`, so the runner can wait for quiescence. */
  version = 0;
  /**
   * The last refusal the server sent this seat. A refusal is an answer: without
   * it, a rejoin that goes unanswered cannot say whether the server turned it
   * down — and which code it used — or never replied at all.
   */
  lastRefusal: string | null = null;
  /**
   * How many refusals this seat has collected all run. A throttled or rejected
   * client is not playing the game it thinks it is, and its view goes stale for
   * a reason the oracle would read as disagreement — so the count is reported
   * even when the run is clean.
   */
  refusals = 0;

  constructor(socket: Socket, username: string, userId: string, cookie: string) {
    this.socket = socket;
    this.username = username;
    this.userId = userId;
    this.cookie = cookie;
    this.listen();
  }

  private listen() {
    this.socket.on("game:state", (state: TableState, ack?: () => void) => {
      ack?.();
      this.state = state;
      this.version += 1;
    });
    for (const event of REFUSAL_EVENTS) {
      this.socket.on(event, (payload: { code?: string; message?: string } | undefined) => {
        this.lastRefusal = `${event} ${payload?.code ?? "?"}: ${payload?.message ?? ""}`.trim();
        this.refusals += 1;
      });
    }
  }

  /** Re-attached after a reconnect, because the socket object is new. */
  adopt(socket: Socket) {
    this.socket = socket;
    this.listen();
  }

  view(): SeatView | null {
    const s = this.state;
    // Two ways to have no opinion worth comparing, and neither is a defect: a
    // dropped socket holds the table as it was when it left, and a player whose
    // seat was vacated after too many drops is sent `viewerSeatIndex: null` and
    // stops being told anything. `null < 0` is false, so this cannot be a
    // numeric comparison.
    const seat = s?.viewerSeatIndex;
    if (!s || typeof seat !== "number" || seat < 0 || !this.socket.connected) return null;
    return {
      seat,
      currentTurnIndex: s.currentTurnIndex,
      gameOver: s.gameOver,
      handCounts: s.players.map((p) => p.handCount),
      ownHand: (s.players[seat]?.hand ?? []).map((c) => c.id),
    };
  }

  /**
   * Acts if it is this seat's move, and says whether it actually did. The
   * runner counts what was emitted rather than how many times it looked,
   * because a harness that has stopped playing must not be able to report
   * progress it never made.
   *
   * Legality comes from the engine rather than from a rule restated here — a
   * soak that plays illegally would spend its time proving the server rejects
   * it.
   */
  act(rng: () => number): boolean {
    const s = this.state;
    const seat = s?.viewerSeatIndex;
    if (!s || s.gameOver || typeof seat !== "number" || seat < 0) return false;

    const phase = s.exchangePhase;
    if (phase?.active) {
      if (phase.winnerIdx !== seat) return false;
      const hand = s.players[seat]?.hand ?? [];
      const giveable = hand.filter((c) => c.id !== phase.cardFromLoser?.id);
      const card = giveable[Math.floor(rng() * giveable.length)];
      if (!card) return false;
      this.socket.emit("game:exchange_give_card", { cardId: card.id });
      return true;
    }

    if (s.currentTurnIndex !== seat) return false;
    const hand = s.players[seat]?.hand ?? [];
    if (hand.length === 0) return false;

    const isNewRound = s.lastPlayedCombination === null;
    const mustPlay = !s.firstPlayMade ? s.startCard : undefined;
    const plays = getAllValidPlays(hand, s.lastPlayedCombination, isNewRound, mustPlay);

    if (plays.length === 0) {
      this.socket.emit("game:pass");
      return true;
    }
    const combo = plays[Math.floor(rng() * plays.length)];
    this.socket.emit("game:play", { cardIds: combo.cards.map((c) => c.id) });
    return true;
  }
}

export interface SoakResult {
  violations: Violation[];
  moves: number;
  manches: number;
  chaosEvents: string[];
  refusals: number;
  seed: number;
}

/**
 * Waits until no client has received a state for `quietMs`, so the views being
 * compared are of the same moment. The server addresses each recipient
 * separately; two views captured mid-broadcast disagree for a reason that is
 * not a defect, and comparing them would make the oracle cry wolf forever.
 */
async function settle(
  seats: Seat[],
  quietMs = 250,
  capMs = 4_000 * DEADLINE_SCALE
): Promise<void> {
  const deadline = Date.now() + capMs;
  let last = seats.reduce((sum, s) => sum + s.version, 0);
  while (Date.now() < deadline) {
    await sleep(quietMs);
    const now = seats.reduce((sum, s) => sum + s.version, 0);
    if (now === last) return;
    last = now;
  }
}

export async function runSoak(opts: Options, log = console.log): Promise<SoakResult> {
  const rng = makeRng(opts.seed);
  const deckSize = createDeck().length;
  const chaosEvents: string[] = [];
  let moves = 0;
  let manches = 0;
  let highWaterMark = deckSize;
  let wasOver = false;

  const server: TestServer = await startTestServer();
  const seats: Seat[] = [];
  try {
    const tag = Date.now().toString(36);
    for (let i = 0; i < opts.seats; i++) {
      const c = await connectAs(server, `soak_${tag}_${i}`);
      seats.push(new Seat(c.socket, c.user.username, c.user.id, c.cookie));
    }

    const host = seats[0];
    const room = await new Promise<RoomState>((resolve) => {
      host.socket.once("room:state", resolve);
      host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: opts.seats });
    });
    for (const seat of seats.slice(1)) {
      await new Promise<void>((resolve) => {
        seat.socket.once("room:state", () => resolve());
        seat.socket.emit("room:join", { code: room.code });
      });
    }
    host.socket.emit("room:start");
    log(`soak: seed ${opts.seed}, ${opts.seats} seats, room ${room.code}`);

    const violations: Violation[] = [];
    const deadline = Date.now() + opts.minutes * 60_000;

    while (Date.now() < deadline && violations.length === 0) {
      await settle(seats);

      const views = seats.map((s) => s.view()).filter((v): v is SeatView => v !== null);
      if (views.length >= 1) {
        const total = views[0].handCounts.reduce((a, b) => a + b, 0);
        violations.push(...checkAll(views, deckSize, highWaterMark));
        // A fresh deal legitimately refills every hand, so the ceiling is reset
        // by a deal rather than being the running maximum of a single manche.
        highWaterMark = Math.max(total, highWaterMark);
      }
      if (violations.length > 0) break;

      const over = seats.every((s) => s.state?.gameOver);
      if (over && !wasOver) {
        manches += 1;
        log(`soak: manche ${manches} finished`);
      }
      wasOver = over;
      if (over) {
        // Both halves: the intent is what the results screen asks, and the vote
        // is what actually deals again once every seated player has answered.
        for (const seat of seats) {
          seat.socket.emit("game:rematch_intent", { wants: true });
          seat.socket.emit("game:rematch_vote");
        }
        // A fresh deal refills every hand, so the ceiling the oracle measures
        // against belongs to the manche that is starting, not the one that
        // just emptied.
        highWaterMark = deckSize;
        await sleep(700);
        continue;
      }

      let acted = false;
      for (const seat of seats) acted = seat.act(rng) || acted;
      if (acted) moves += 1;
      if (acted && moves % 25 === 0 && views[0]) {
        log(`soak: move ${moves}, hands [${views[0].handCounts}]`);
      }

      // Drawn per move, never per loop pass. A pass that took no turn is the
      // runner spinning while the server thinks, so how many of those happen is
      // wall-clock, and drawing there spends the generator at a rate the seed
      // does not control — two runs of one seed then diverge, and the seed the
      // failure prints replays a different game.
      if (acted && rng() < opts.chaos) {
        const victim = seats[Math.floor(rng() * seats.length)];
        chaosEvents.push(`drop+rejoin ${victim.username} at move ${moves}`);
        victim.socket.close();
        await sleep(200 + Math.floor(rng() * 600));
        const back = await reconnectWith(server, victim.cookie);
        const before = victim.version;
        victim.adopt(back);
        victim.lastRefusal = null;
        back.emit("game:rejoin", { roomId: room.roomId });
        // A reconnecting client that is never sent the table sits on a screen
        // that will not correct itself. Waiting also keeps the oracle honest:
        // without it, an unanswered rejoin reads as a stale view instead.
        const answeredBy = Date.now() + REJOIN_BUDGET_MS;
        while (victim.version === before && Date.now() < answeredBy) await sleep(100);
        if (victim.version === before) {
          violations.push({
            kind: "rejoin-unanswered",
            detail:
              `${victim.username} reconnected and emitted game:rejoin, and was sent no ` +
              `state within ${REJOIN_BUDGET_MS}ms — ` +
              (victim.lastRefusal
                ? `the server refused it with ${victim.lastRefusal}`
                : "and the server said nothing at all"),
          });
        }
      }
    }

    // The last broadcast of a hand has no successor to correct it, so a view
    // captured before the table went quiet is exactly the one worth checking.
    await settle(seats);
    const finalViews = seats.map((s) => s.view()).filter((v): v is SeatView => v !== null);
    violations.push(...checkAll(finalViews, deckSize, highWaterMark));

    return {
      violations,
      moves,
      manches,
      chaosEvents,
      refusals: seats.reduce((sum, s) => sum + s.refusals, 0),
      seed: opts.seed,
    };
  } finally {
    for (const seat of seats) if (seat.socket.connected) seat.socket.close();
    await server.stop();
  }
}

async function main() {
  if (!hasDatabase()) {
    console.error("soak: DATABASE_URL is not set — the soak needs a real database");
    process.exit(2);
  }
  const opts = parseArgs(process.argv.slice(2));
  const result = await runSoak(opts);

  console.log(
    `soak: ${result.moves} rounds of moves, ${result.manches} manches, ` +
      `${result.chaosEvents.length} disconnections, ${result.refusals} refusals`
  );
  if (result.violations.length === 0) {
    console.log(`soak: no disagreement found (seed ${result.seed})`);
    return;
  }
  // Not "replay": measured, two runs of one seed still diverge. The deal and
  // every choice made from it repeat; how the four clients interleave against a
  // live server does not, and that is what decides which move a drop lands on.
  console.error(
    `\nsoak: FAILED with seed ${result.seed}. Re-run it with --seed ${result.seed} — ` +
      `same deal and same choices, not the same interleaving.`
  );
  for (const v of result.violations) console.error(`  [${v.kind}] ${v.detail}`);
  console.error("\nchaos leading up to it:");
  for (const e of result.chaosEvents.slice(-10)) console.error(`  ${e}`);
  process.exit(1);
}

// Only when run directly. Comparing the resolved URL rather than matching on
// the path text: a test file importing runSoak has "soak" in its own path too,
// and a substring check started a second server racing the first for the
// schema it was creating.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((err) => {
    console.error("soak: crashed", err);
    process.exit(1);
  });
}
