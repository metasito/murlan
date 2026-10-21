import React, { useCallback, useMemo, useState } from "react";
import type { SharedValue } from "react-native-reanimated";
import { A11yStatus } from "@/lib/a11y";
import { useTranslation } from "@/lib/i18n";
import type { ExchangeAnnounceData } from "@/lib/game/sharedGameFlow";
import type { CardFrom } from "@/components/flightPose";
import type { HandOrder } from "@/components/useHandOrder";
import type { ExchangeStages } from "./exchangeModel";
import { StraightHand, useHandArrival, type HandDeal } from "./hand";
import { HandStatus, type SettledSelection } from "./selectionLeaves";
import { arrangedLabel } from "./spokenLabels";
import type { TableFacts } from "./stagedPlay";
import type { HandSelection } from "./useSelection";

/**
 * The viewer's own row: the hand as the exchange leaves it on the table, arranged, and announced.
 * Its own module so a test mocking `StraightHand` off `./hand` still sees every render of it.
 */
export function HandRow({
  facts,
  turnShown,
  viewerSeat,
  arrangement,
  exchange,
  deal,
  geometry,
  selection,
}: {
  facts: TableFacts;
  /** The turn as the table shows it, which waits out the deal. */
  turnShown: boolean;
  /** Null for a spectator, whose hand is backs and is nobody's to arrange. */
  viewerSeat: number | null;
  arrangement: HandOrder;
  exchange: {
    shown: ExchangeAnnounceData | null;
    stages: ExchangeStages;
    giveableIds: string[] | undefined;
    lifted: SharedValue<string[]>;
  };
  deal: { key: number; hand: HandDeal | undefined };
  geometry: {
    availW: number;
    roomW: number;
    bottomPad: number;
    scale: number;
    onOrigins: (origins: ReadonlyMap<string, CardFrom>) => void;
  };
  selection: { store: SettledSelection; ui: HandSelection; onActivate: (id: string) => void };
}) {
  const { t } = useTranslation();
  const spectating = viewerSeat === null;
  const { arranged: shownHand, moveTo, order } = arrangement;
  const { handOnTable, holding, arrivingIndex, descendingId, receivedId } = useHandArrival({
    hand: shownHand,
    sorted: facts.hand,
    order,
    announced: exchange.shown,
    stages: exchange.stages,
    viewerSeat,
  });
  // Where the last move put a card. A drag shows its own answer; the discrete
  // actions behind it (WCAG 2.5.7) move a card with nothing on screen changing
  // for whoever asked, so the live region below says where it went.
  const [arranged, setArranged] = useState<{ id: string; to: number } | null>(null);
  const arrange = useCallback(
    (id: string, to: number) => {
      moveTo(id, to);
      setArranged({ id, to });
    },
    [moveTo]
  );
  const arrangedA11yLabel = useMemo(
    () =>
      arranged === null
        ? null
        : arrangedLabel(
            shownHand.find((c) => c.id === arranged.id),
            arranged.to,
            handOnTable.length,
            t
          ),
    [arranged, shownHand, handOnTable.length, t]
  );

  return (
    <HandStatus store={selection.store} cardCount={handOnTable.length}>
      {arrangedA11yLabel !== null && <A11yStatus label={arrangedA11yLabel} />}
      <StraightHand
        key={deal.key}
        faceDown={spectating}
        cards={handOnTable}
        store={selection.store}
        selection={selection.ui}
        onActivate={selection.onActivate}
        disabled={facts.isFinished || spectating}
        giveableIds={exchange.giveableIds}
        giveHint={t("exchange.cardA11yHint")}
        refuseHint={t("exchange.cardA11yNotGiveable")}
        availW={geometry.availW}
        roomW={geometry.roomW}
        isMyTurn={turnShown && !facts.isFinished}
        scale={geometry.scale}
        // Off whenever a card is held back or lent: the fan is drawn
        // without the state's hand, but `arrange` moves within it, so
        // a drop would land a slot from where the finger let go.
        onReorder={spectating || holding ? undefined : arrange}
        arrivingIndex={arrivingIndex}
        descendingId={descendingId}
        receivedId={receivedId}
        lifted={exchange.lifted}
        handBottomPad={geometry.bottomPad}
        onOrigins={geometry.onOrigins}
        // Only while the opening is still owed. Named rather than
        // counted to: Maestro's `index` sorts by position, and the
        // arc puts the outermost card below its neighbours (#757).
        deal={deal.hand}
        startCardId={facts.demand.mustInclude?.id}
      />
    </HandStatus>
  );
}
