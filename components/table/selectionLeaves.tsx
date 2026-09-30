import React, { useMemo, useSyncExternalStore } from "react";
import { View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import type { Card, Combination, GameState } from "@/lib/game/gameEngine";
import { useTranslation } from "@/lib/i18n";
import { A11yStatus } from "@/lib/a11y";
import { event, uiFeedback } from "@/lib/device/feedback";
import { useGiocaCues } from "@/components/useTableFeedback";
import { GiocaButton } from "./actions";
import { harnessState } from "./chrome";
import { handLabel, playRefusalLabel } from "./spokenLabels";
import { readStagedPlay } from "./stagedPlay";
import { NO_SELECTION, settle, type Selection, type SelectionMode, type SelectionStore } from "./selection";

/** The selection as it applies to one hand and mode, which is what every leaf subscribes to. */
export type SettledSelection = Pick<SelectionStore, "get" | "subscribe">;

/** Settles once per store value, so a leaf's pick of `ids` is the same array until the store moves. */
export function settledSelection(store: SelectionStore, hand: readonly string[], mode: SelectionMode): SettledSelection {
  let raw: Selection | null = null;
  let shown = NO_SELECTION;
  return {
    subscribe: store.subscribe,
    get: () => {
      const now = store.get();
      if (now !== raw) {
        raw = now;
        shown = settle(now, hand, mode);
      }
      return shown;
    },
  };
}

const NO_IDS: string[] = [];
const stagedCount = (s: Selection) => (s.mode === "exchange" ? 0 : s.ids.length);

/** The hand's spoken status, and the harness's copy of it, around the hand it describes. */
export function HandStatus({
  store,
  cardCount,
  children,
}: {
  store: SettledSelection;
  cardCount: number;
  children: React.ReactNode;
}) {
  const { tn } = useTranslation();
  const count = useSyncExternalStore(store.subscribe, () => stagedCount(store.get()));
  const label = handLabel(cardCount, count, tn);
  return (
    // No `accessible` here: it would hide every card's own label behind one leaf.
    <View {...harnessState({ handState: label })}>
      <A11yStatus label={label} />
      {children}
    </View>
  );
}

/** GIOCA with what it stages: the play and why it is refused, or the exchange's pick. */
export function GiocaControl({
  store,
  hand,
  lastPlayedCombination,
  startCard,
  firstPlayMade,
  isNewRound,
  isMyTurn,
  isFinished,
  giveTo,
  lit,
  rejectX,
  rejectPlay,
  onRefuse,
  onPlay,
  onGive,
  size,
  scale,
}: {
  store: SettledSelection;
  hand: Card[];
  lastPlayedCombination: Combination | null;
  startCard: GameState["startCard"];
  firstPlayMade: boolean;
  isNewRound: boolean;
  isMyTurn: boolean;
  isFinished: boolean;
  /** Who the exchange's card goes to, while the exchange has borrowed the key; null for a play. */
  giveTo: string | null;
  lit: boolean;
  rejectX: SharedValue<number>;
  rejectPlay: () => void;
  onRefuse: (reason: string) => void;
  onPlay: (cardIds: string[]) => void;
  onGive: (cardId: string) => void;
  size: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const ids = useSyncExternalStore(store.subscribe, () => store.get().ids);
  const giving = giveTo !== null;
  const selectedIds = giving ? NO_IDS : ids;
  const staged = useMemo(
    () =>
      readStagedPlay({
        hand,
        selectedIds,
        lastPlayedCombination,
        startCard,
        firstPlayMade,
        isNewRound,
        isMyTurn,
        isFinished,
      }),
    [hand, selectedIds, lastPlayedCombination, startCard, firstPlayMade, isNewRound, isMyTurn, isFinished]
  );
  const reason = playRefusalLabel({ refusal: staged.refusal, isMyTurn, isFinished, startCard }, t);
  const pick = giving ? (ids[0] ?? null) : null;
  const picked = pick === null ? null : (hand.find((c) => c.id === pick) ?? null);
  const { flashStyle, glowStyle } = useGiocaCues(staged.playable, selectedIds.length, isMyTurn && !isFinished);

  // The button stays pressable while it is unavailable so a refusal has a
  // channel: a rigid haptic, a shake, and the reason in words.
  const refuse = (text: string) => {
    event([{ kind: "reject" }]);
    onRefuse(text);
    rejectPlay();
  };
  const play = () => {
    if (!staged.playable) return refuse(reason);
    // Haptic only: the landing sounds when the card reaches the pile.
    uiFeedback("selection");
    // The validated set, not the raw selection: the server rejects — silently —
    // any request naming a card the hand does not hold.
    onPlay(staged.cards.map((c) => c.id));
  };
  // GIOCA is the exchange's confirm: a second button would be the dialog this replaced (#532).
  const give = () => {
    if (pick === null) return refuse(t("exchange.confirmA11yWaiting", { name: giveTo ?? "" }));
    event([{ kind: "give" }]);
    onGive(pick);
  };

  return (
    <GiocaButton
      lit={lit}
      label={giving ? t("exchange.confirm") : t("gameTable.playLabelGioca")}
      rejectX={rejectX}
      flashStyle={flashStyle}
      glowStyle={glowStyle}
      onPress={giving ? give : play}
      // The count is left out of the name: a button renamed on every tap is
      // re-announced on every tap. `tests/e2e/helpers/bot.ts` reads this exact
      // sentence as the signal that the play is legal.
      a11yLabel={staged.playable ? t("gameTable.playA11yValid") : t("gameTable.playA11yUnavailable", { reason })}
      exchange={giving ? { toName: giveTo, picked } : undefined}
      selectedCount={selectedIds.length}
      size={size}
      scale={scale}
    />
  );
}
