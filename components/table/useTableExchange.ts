import { useCallback, useMemo, useState } from "react";
import { getValidGivebackCards, type Card } from "@/lib/game/gameEngine";
import type { ViewedGameState } from "@/shared/protocol";
import { buildExchangeAnnounce, type ExchangeAnnounceData } from "@/lib/game/sharedGameFlow";
import type { LegStage } from "@/lib/timeline/exchangeTimeline";
import { useTranslation } from "@/lib/i18n";
import type { LegName } from "./ExchangeLegs";
import {
  exchangeKey,
  exchangeNotes,
  NO_STAGES,
  readExchange,
  readExchangeSeats,
  type ExchangeStages,
  type ExchangeView,
  type PileNote,
} from "./exchangeModel";

export interface TableExchange {
  /** The live phase, from the viewer's seat. */
  exchange: ExchangeView;
  /** What the legs draw: the announcement, or the receive of a phase that has just opened. */
  shownExchange: ExchangeAnnounceData | null;
  stages: ExchangeStages;
  onExchangeStage: (key: string, leg: LegName, stage: LegStage) => void;
  onExchangeLegsReady: (key: string) => void;
  exchangeLit: number[];
  exchangeShift: Map<number, number>;
  exchangeIsWinners: boolean;
  /** The viewer's choice is open: the winner, once the received card has been read. */
  exchangeIsMine: boolean;
  giveableIds: string[] | undefined;
  exchangeLoserName: string;
  choiceOpen: boolean;
  exchangeChip: string | null;
  pileNote: PileNote | null;
}

/** The exchange as the table shows it: what flies, each leg's stage, the seats it marks, the choice and its words. */
export function useTableExchange(input: {
  gameState: ViewedGameState;
  viewerSeat: number;
  spectating: boolean;
  /** The announcement while it is visible. */
  announcement: ExchangeAnnounceData | null;
  onExchangeReady?: () => void;
  sortedHand: Card[];
}): TableExchange {
  const { gameState, viewerSeat, spectating, announcement, onExchangeReady, sortedHand } = input;
  const { t } = useTranslation();
  const players = gameState.players;
  const phase = gameState.exchangePhase;
  const exchange = useMemo(
    () => readExchange({ exchangePhase: phase, players }, viewerSeat, spectating),
    [phase, players, viewerSeat, spectating]
  );
  // The exchange runs from the phase opening, before any announcement: the receive flies ahead of the choice.
  const shownExchange: ExchangeAnnounceData | null =
    announcement ??
    (phase?.kind === "open" ? buildExchangeAnnounce(players, phase, { received: phase.cardFromLoser }) : null);
  // A pairing and its card repeat across rounds, so each exchange is also counted.
  const [exchangeSeq, setExchangeSeq] = useState({ open: false, seq: 0 });
  if (!!shownExchange !== exchangeSeq.open) setExchangeSeq({ open: !!shownExchange, seq: exchangeSeq.seq + (shownExchange ? 1 : 0) });
  const exchangeId = shownExchange ? `${exchangeSeq.seq}:${exchangeKey(shownExchange)}` : "";
  const [reported, setReported] = useState<ExchangeStages>({ key: "", ...NO_STAGES });
  const stages: ExchangeStages = shownExchange && reported.key === exchangeId ? reported : { key: exchangeId, ...NO_STAGES };
  const choiceReady = reported.key === exchangeId && reported.ready;
  const onExchangeStage = useCallback((key: string, leg: LegName, stage: LegStage) => {
    setReported((s) => ({ ...(s.key === key ? s : { key, ...NO_STAGES }), [leg]: stage }));
  }, []);
  const onExchangeLegsReady = useCallback(
    (key: string) => {
      setReported((s) => ({ ...(s.key === key ? s : { key, ...NO_STAGES }), ready: true }));
      onExchangeReady?.();
    },
    [onExchangeReady]
  );
  const seats = readExchangeSeats(shownExchange, stages);
  const exchangeIsWinners = exchange.open && exchange.viewerIsWinner;
  const exchangeIsMine = exchangeIsWinners && choiceReady;

  // The winner picks from their own hand rather than from a filtered row in a
  // dialog, so the legality the engine enforces has to be readable in the fan:
  // `getValidGivebackCards` is the same call `processExchangeChoice` validates
  // against, asked here only to decide which cards light up.
  const giveable = useMemo(
    () => (exchangeIsMine && exchange.open ? getValidGivebackCards(sortedHand, exchange.cardFromLoser.id) : undefined),
    [exchangeIsMine, sortedHand, exchange]
  );
  const giveableIds = useMemo(() => giveable?.map((c) => c.id), [giveable]);
  const notes = exchangeNotes({ shown: shownExchange, stages, live: exchange, giveable, players, viewerSeat, spectating, t });

  return {
    exchange,
    shownExchange,
    stages,
    onExchangeStage,
    onExchangeLegsReady,
    exchangeLit: seats.lit,
    exchangeShift: seats.shift,
    exchangeIsWinners,
    exchangeIsMine,
    giveableIds,
    exchangeLoserName: exchange.loser?.name ?? "",
    choiceOpen: exchange.open && stages.ready,
    exchangeChip: notes.chip,
    pileNote: notes.pileNote,
  };
}
