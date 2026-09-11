// The whole table in words, for a screen reader.
//
// JSX-free and relatively imported, so `node --test` can load it: docs/agents/loops.md.

// ─── Screen-reader description ─────────────────────────────────────────────────
//
// The whole table in words. Every phrase arrives already translated from
// GameTable.tsx, so this stays testable under `node --test` with no i18n
// runtime. Ordered by tactical importance to someone who cannot see the board:
// whose turn, what was last played and by whom, each opponent's card count,
// then the viewer's own hand size.

export interface TableA11yOpponent {
  name: string;
  cardCount: number;
}

export interface TableA11yLastPlay {
  /** Already-translated description of the play, e.g. "coppia di 8". */
  label: string;
  byViewer: boolean;
  /** Ignored when `byViewer` is true. */
  byName: string;
}

export interface TableA11yExchange {
  active: boolean;
  viewerIsWinner: boolean;
  viewerIsLoser: boolean;
  /** Ignored unless `viewerIsLoser`. */
  winnerName: string;
  /** Ignored unless `viewerIsWinner`. */
  loserName: string;
}

export interface TableA11yStrings {
  yourTurn: string;
  turnOf: (name: string) => string;
  emptyTable: string;
  youPlayed: (label: string) => string;
  playerPlayed: (name: string, label: string) => string;
  opponentCardCount: (name: string, count: number) => string;
  yourCardCount: (count: number) => string;
  exchangeGiveCard: (loserName: string) => string;
  exchangeWaitForCard: (winnerName: string) => string;
}

export interface TableA11yInput {
  isMyTurn: boolean;
  /** Ignored when `isMyTurn` is true. */
  currentTurnName: string;
  myCardCount: number;
  /** Null when nobody has led the round yet. */
  lastPlay: TableA11yLastPlay | null;
  /** Every opponent — never the viewer. */
  opponents: TableA11yOpponent[];
  exchange?: TableA11yExchange;
}

/**
 * Assembles the table into one sentence-per-fact description, in the fixed
 * priority order above. The exchange phase (§10 of docs/RULES.md) replaces
 * the turn sentence for whichever of the two players it actually concerns —
 * a bystander mid-exchange just sees the ordinary turn state, since nothing
 * is asked of them.
 */
export function describeTableForA11y(input: TableA11yInput, strings: TableA11yStrings): string {
  const parts: string[] = [];

  if (input.exchange?.active && (input.exchange.viewerIsWinner || input.exchange.viewerIsLoser)) {
    parts.push(
      input.exchange.viewerIsWinner
        ? strings.exchangeGiveCard(input.exchange.loserName)
        : strings.exchangeWaitForCard(input.exchange.winnerName)
    );
  } else {
    parts.push(input.isMyTurn ? strings.yourTurn : strings.turnOf(input.currentTurnName));
  }

  parts.push(
    input.lastPlay
      ? input.lastPlay.byViewer
        ? strings.youPlayed(input.lastPlay.label)
        : strings.playerPlayed(input.lastPlay.byName, input.lastPlay.label)
      : strings.emptyTable
  );

  for (const opp of input.opponents) {
    parts.push(strings.opponentCardCount(opp.name, opp.cardCount));
  }

  parts.push(strings.yourCardCount(input.myCardCount));

  return parts.join(" ");
}
