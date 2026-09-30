import type { ReactElement } from "react";
import { View } from "react-native";
import { SEAT_DISC } from "@/components/seatLayout";
import type { KindTone, NoticeKind } from "../noticeModel";
import { ErrorToast, PassFloat, RejectFloat } from "./floats";
import { EmptyHandLine, WaitingLine } from "./tableLines";
import { HudComboPill, OfflinePill, TurnChip } from "./hud";
import { WhoStartsCard } from "./panels";
import { ComboMark, PileLabelMark, RoundWinnerMark } from "./pileNotices";
import { PassedMark, ReconnectingMark, VacatedMark } from "./seatMarks";

const underDisc = (scale: number) => {
  const disc = SEAT_DISC * scale;
  return (
    <View style={{ width: disc, height: disc }}>
      <PassedMark side="side" disc={disc} scale={scale} />
    </View>
  );
};

const turn = (scale: number, lit: boolean, seconds: number) => ({
  scale,
  lit,
  seconds,
  active: true,
  resetKey: "gallery",
  chipText: lit ? "Your turn" : "Turn of Besnik",
  spokenSeat: "",
});

export type NoticeFixture<K extends NoticeKind = NoticeKind> = {
  name: string;
  tone: KindTone<K>;
  render: (scale: number) => ReactElement;
};

export const NOTICE_GALLERY = {
  hudCombo: [
    { name: "table clear", tone: "neutral", render: (scale) => <HudComboPill scale={scale} play={null} /> },
    { name: "a pair", tone: "neutral", render: (scale) => <HudComboPill scale={scale} play={{ name: "Besnik", combo: "Coppia" }} /> },
  ],
  turn: [
    { name: "a bot on move", tone: "neutral", render: (scale) => <TurnChip {...turn(scale, false, 30)} /> },
    { name: "your turn", tone: "lit", render: (scale) => <TurnChip {...turn(scale, true, 30)} /> },
    { name: "your last seconds", tone: "urgent", render: (scale) => <TurnChip {...turn(scale, true, 3)} /> },
    {
      name: "reconnecting",
      tone: "neutral",
      render: (scale) => <TurnChip {...turn(scale, true, 30)} connection={{ state: "reconnecting", text: "Reconnecting…" }} />,
    },
    {
      name: "back online",
      tone: "ok",
      render: (scale) => <TurnChip {...turn(scale, true, 30)} active={false} connection={{ state: "reconnected", text: "Besnik is back" }} />,
    },
    {
      name: "offline",
      tone: "bad",
      render: (scale) => <TurnChip {...turn(scale, true, 30)} connection={{ state: "offline", text: "No internet connection" }} />,
    },
  ],
  offline: [{ name: "off the table", tone: "solid", render: (scale) => <OfflinePill scale={scale} /> }],
  whoStarts: [
    {
      name: "a seat holds the start card, gated",
      tone: "neutral",
      render: (scale) => (
        <WhoStartsCard
          gated
          scale={scale}
          starterName="Besnik"
          starterIsViewer={false}
          reason={{ type: "start_card", card: { id: "3_clubs", rank: "3", suit: "clubs", isJoker: false }, playerIdx: 1 }}
        />
      ),
    },
    {
      name: "you hold the 3 of spades",
      tone: "neutral",
      render: (scale) => (
        <WhoStartsCard
          gated={false}
          scale={scale}
          starterName="Ana"
          starterIsViewer
          reason={{ type: "start_card", card: { id: "3_spades", rank: "3", suit: "spades", isJoker: false }, playerIdx: 0 }}
        />
      ),
    },
    {
      name: "a seat lost the round",
      tone: "neutral",
      render: (scale) => (
        <WhoStartsCard gated scale={scale} starterName="Gent" starterIsViewer={false} reason={{ type: "lost_round", playerIdx: 3 }} />
      ),
    },
  ],
  combo: [
    { name: "a pair", tone: "lit", render: (scale) => <ComboMark scale={scale} label="Coppia" /> },
    { name: "a bomb, the same mark", tone: "lit", render: (scale) => <ComboMark scale={scale} label="Bomba ×4" /> },
  ],
  roundWinner: [{ name: "a seat took the round", tone: "lit", render: (scale) => <RoundWinnerMark scale={scale} name="Besnik" /> }],
  pileLabel: [
    {
      name: "the exchange's card on the pile",
      tone: "lit",
      render: (scale) => <PileLabelMark scale={scale} testID="exchange-pile-label" text="Luan dà 2♥ a Ana" />,
    },
  ],
  passed: [{ name: "a seat passed", tone: "neutral", render: underDisc }],
  reconnecting: [
    { name: "a seat reconnecting", tone: "neutral", render: (scale) => <ReconnectingMark seconds={25} resetKey="gallery" scale={scale} /> },
  ],
  vacated: [{ name: "a seat left", tone: "neutral", render: (scale) => <VacatedMark username="Besnik" scale={scale} /> }],
  passFloat: [{ name: "your own pass", tone: "neutral", render: (scale) => <PassFloat text="Passo" scale={scale} /> }],
  rejectFloat: [
    { name: "a play too low", tone: "bad", render: (scale) => <RejectFloat text="carta troppo bassa" scale={scale} /> },
    {
      name: "the longest reason, mirrored",
      tone: "bad",
      render: (scale) => <RejectFloat text="deve avere lo stesso numero di carte di quella sul tavolo" scale={scale} mirrored />,
    },
  ],
  errorToast: [{ name: "the server refuses a pass", tone: "bad", render: (scale) => <ErrorToast text="Non puoi passare" scale={scale} /> }],
  waitingOthers: [{ name: "you went out", tone: "gold", render: (scale) => <WaitingLine scale={scale} /> }],
  emptyHand: [{ name: "your hand played out", tone: "gold", render: (scale) => <EmptyHandLine scale={scale} /> }],
} satisfies { [K in NoticeKind]: NoticeFixture<K>[] };
