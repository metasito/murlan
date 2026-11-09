// What the table's two HUD pills say in each state the table can be in, read off the functions the
// table itself calls, with a `t` that returns the key instead of the words, so the content is the
// catalogue keys the metrics measure and no mapping from state to words is written here.
import type { NoticeContent, NoticePart } from "../../components/table/noticeWidth.ts";
import { CHIP_KEYS, turnPresentation } from "../../components/turnTimerUi.ts";
import { comboLabel } from "../../components/table/noticeModel.ts";
import { exchangeNotes, type ExchangeView } from "../../components/table/exchangeModel.ts";
import type { ExchangeAnnounceData } from "../../lib/game/sharedGameFlow.ts";
import { createDeck, type Card, type Combination, type GameState } from "../../lib/game/gameEngine.ts";
import type { TFn, TranslationKey } from "../../lib/i18n.ts";
import { CAPTURE_VIEWER_SEAT, captureGameState, type CaptureState } from "../../lib/captureStates.ts";
import { seatDirection, type OpponentSide } from "../../components/seatLayout.ts";
import type { TableState } from "../../components/tableRects.ts";
import { catalogs, templateParts, type Locale } from "../../shared/i18n.ts";

export const tagged = ((key: TranslationKey, params?: Record<string, string | number>) =>
  `⟦${key}⟧${Object.values(params ?? {}).map((v) => `⟨${v}⟩`).join("")}`) as TFn;

/** `⟦key⟧⟨slot⟩…` as the runs of one role, each with the words its slots are filled with. */
export function runsOf(tag: string, role: "text" | "strong"): NoticePart[] {
  const out: NoticePart[] = [];
  for (const m of tag.matchAll(/⟦([^⟧]+)⟧((?:⟨[^⟩]*⟩)*)/g)) {
    const slots = [...m[2].matchAll(/⟨([^⟩]*)⟩/g)].map((s) => s[1]);
    out.push({ run: `${role}:${m[1]}`, slots });
  }
  return out;
}

const DECK = createDeck();
const card = (rank: string): Card => DECK.find((c) => c.rank === rank && c.suit !== null)!;

export interface ChipScene {
  name: string;
  combo: NoticeContent;
  turn: NoticeContent;
}

const CLOCK: NoticePart = { runtime: "strong" };
const DOT: NoticePart = { dot: true };

/** The turn chip for each state the turn can read, with `name` on the move. */
export function turnScenes(name: string): { name: string; turn: NoticeContent }[] {
  const say = (i: { roundOver: boolean; matchOver: boolean; dealing: boolean; mine: boolean }) =>
    turnPresentation({
      roundOver: i.roundOver,
      matchOver: i.matchOver,
      dealing: i.dealing,
      shownTurnIsMine: i.mine,
      onMoveName: name,
      exchange: { chip: null, choiceOpen: false, viewerIsWinner: false, open: false, winnerSeat: null },
      shownTurnSeat: i.mine ? 0 : 1,
      isBot: () => false,
      isMyTurn: i.mine,
      isFinished: false,
      isNewTrick: false,
      holdingForStart: false,
      held: false,
      turnToken: "",
      t: tagged,
    }).chip.text;
  const states = [
    { roundOver: true, matchOver: true, dealing: false, mine: false },
    { roundOver: true, matchOver: false, dealing: false, mine: false },
    { roundOver: false, matchOver: false, dealing: true, mine: false },
    { roundOver: false, matchOver: false, dealing: false, mine: true },
    { roundOver: false, matchOver: false, dealing: false, mine: false },
  ];
  if (new Set(states.map((s) => say(s))).size !== Object.keys(CHIP_KEYS).length) throw new Error("the turn states no longer cover CHIP_KEYS");
  return states.map((s) => ({ name: say(s), turn: [DOT, ...runsOf(say(s), "text"), CLOCK] }));
}

/** The pill for a play on top of the pile: who played it, and what. */
export function comboScene(combo: Combination | null, by: { you: boolean; name: string }): NoticeContent {
  const label = comboLabel(combo, tagged);
  if (label === null) return runsOf(tagged("gameShared.emptyTable"), "text");
  return [by.you ? runsOf(tagged("gameShared.you"), "text")[0] : { runtime: "text", text: by.name }, ...runsOf(label, "strong")];
}

/** Each chair's view of an open exchange between two players called `name`. */
const views = (name: string): Record<"winner" | "loser" | "watcher", ExchangeView> => {
  const player = { name } as never;
  const open = { open: true, winner: player, loser: player, cardFromLoser: card("3") } as const;
  return {
    winner: { ...open, viewerIsWinner: true, viewerIsLoser: false, winnerSeat: 0 },
    loser: { ...open, viewerIsWinner: false, viewerIsLoser: true, winnerSeat: 1 },
    watcher: { ...open, viewerIsWinner: false, viewerIsLoser: false, winnerSeat: 1 },
  };
};
const CLOSED: ExchangeView = { open: false, viewerIsWinner: false, viewerIsLoser: false, winner: null, loser: null };

/** Every exchange the table announces, from each chair, as the pair of pills it draws together. */
export function exchangeScenes(name: string): ChipScene[] {
  const players = [{ name }, { name }, { name }];
  const out: ChipScene[] = [];
  const announce = (winnerIdx: number, loserIdx: number, extra: Partial<ExchangeAnnounceData>): ExchangeAnnounceData => ({
    winnerName: name,
    loserName: name,
    winnerIdx,
    loserIdx,
    twoJokers: false,
    oneWay: false,
    ...extra,
  });
  for (const [seat, view] of Object.entries(views(name)) as ["winner" | "loser" | "watcher", ExchangeView][]) {
    const winnerIdx = seat === "winner" ? 0 : 1;
    const loserIdx = seat === "loser" ? 0 : 2;
    const shapes: [string, ExchangeAnnounceData][] = [
      ["twoJokers", announce(winnerIdx, loserIdx, { twoJokers: true })],
      ["oneWay", announce(winnerIdx, loserIdx, { oneWay: true, cardReceived: card("K") })],
      ["give", announce(winnerIdx, loserIdx, { cardReceived: card("K"), cardGiven: card("4") })],
    ];
    for (const [shape, shown] of shapes) {
      for (const stages of [
        { key: "", receive: "rest", give: "waiting", ready: true },
        { key: "", receive: "rest", give: "rest", ready: true },
      ] as const) {
        const { chip, pillNote } = exchangeNotes({ shown, stages, live: shown.twoJokers ? CLOSED : view, players, viewerSeat: 0, spectating: false, t: tagged });
        if (chip === null) continue;
        out.push({
          name: `${shape} as ${seat}, give ${stages.give}`,
          combo: pillNote ? runsOf(pillNote.text, "text") : runsOf(tagged("gameShared.emptyTable"), "text"),
          turn: [DOT, ...runsOf(chip, "text"), CLOCK],
        });
      }
    }
  }
  return out;
}

export interface DrawnTable {
  game: GameState;
  base: Omit<TableState, "chips">;
  onMove: string;
  lastBy: string | null;
}

/** A captured state as the table draws it, the HUD pills aside. */
export function capturedTable(state: CaptureState): DrawnTable {
  return gameTable(captureGameState(state));
}

/** A game as the table draws it from the viewer's chair, the HUD pills aside. */
export function gameTable(game: GameState): DrawnTable {
  const seats: TableState["seats"] = { top: null, left: null, right: null };
  game.players.forEach((p, seat) => {
    const dir = seatDirection(seat, CAPTURE_VIEWER_SEAT, game.players.length);
    if (dir !== "bottom") seats[dir as OpponentSide] = { name: p.name, cards: p.hand.length };
  });
  const viewer = game.players[CAPTURE_VIEWER_SEAT];
  const combo = game.lastPlayedCombination;
  return {
    game,
    onMove: game.players[game.currentTurnIndex]?.name ?? "",
    lastBy: combo ? (game.players[game.lastPlayedBy]?.name ?? null) : null,
    base: {
      seats,
      hand: { cards: viewer.hand.length, onTurn: game.currentTurnIndex === CAPTURE_VIEWER_SEAT, faceDown: false, raised: raisedFor(game) },
      pile: combo?.cards.length ?? 0,
    },
  };
}

/** The hand is lifted while its chair has something to do: its turn, or an open exchange's giveback. */
function raisedFor(game: GameState): boolean {
  const phase = game.exchangePhase;
  return phase?.kind === "open" ? phase.winnerIdx === CAPTURE_VIEWER_SEAT : game.currentTurnIndex === CAPTURE_VIEWER_SEAT;
}

/** The words a pill's content reads in `locale`, as its plate's text would. */
export function wordsOf(content: NoticeContent, locale: Locale): string {
  return content
    .map((part) => {
      if ("dot" in part) return "";
      if ("runtime" in part) return part.text ?? "";
      const key = part.run.slice(part.run.indexOf(":") + 1);
      const { runs } = templateParts(catalogs[locale][key as TranslationKey]);
      return runs.map((r, i) => r + (part.slots?.[i] ?? "")).join("");
    })
    .join("");
}

/**
 * The pills a table draws, picked by the words they read: the content whose words are the plate's
 * text, with the clock's digits as they read when it was measured. An exchange's pills are the ones
 * `exchangeScenes` says for a table whose every seat is called `exchangeName`. Null for a pill whose
 * words no scene here says.
 */
export function drawnChips(
  table: DrawnTable,
  locale: Locale,
  read: { combo: string; turn: string },
  exchangeName?: string
): { combo: NoticeContent | null; turn: NoticeContent | null } {
  const exchange = exchangeName === undefined ? [] : exchangeScenes(exchangeName);
  const combos = [
    comboScene(table.game.lastPlayedCombination, { you: table.game.lastPlayedBy === CAPTURE_VIEWER_SEAT, name: table.lastBy ?? "" }),
    ...exchange.map((s) => s.combo),
  ];
  const digits = read.turn.match(/\d+$/)?.[0];
  const turn = [...turnScenes(table.onMove), ...exchange]
    .map((s) => [...s.turn.slice(0, -1), ...(digits ? [{ runtime: "strong", text: digits } as const] : [])])
    .find((c) => wordsOf(c, locale) === read.turn);
  return { combo: combos.find((c) => wordsOf(c, locale) === read.combo) ?? null, turn: turn ?? null };
}
