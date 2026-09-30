import type { ReactElement } from "react";
import { View } from "react-native";
import { SEAT_DISC } from "@/components/seatLayout";
import type { KindTone, NoticeKind } from "../noticeModel";
import { HudComboPill, OfflinePill, TurnChip } from "./hud";
import { WhoStartsCard } from "./panels";
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
      render: (scale) => <TurnChip {...turn(scale, true, 30)} connection={{ state: "reconnected", text: "Besnik is back" }} />,
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
  passed: [{ name: "a seat passed", tone: "neutral", render: underDisc }],
  reconnecting: [
    { name: "a seat reconnecting", tone: "neutral", render: (scale) => <ReconnectingMark seconds={25} resetKey="gallery" scale={scale} /> },
  ],
  vacated: [{ name: "a seat left", tone: "neutral", render: (scale) => <VacatedMark username="Besnik" scale={scale} /> }],
} satisfies { [K in NoticeKind]: NoticeFixture<K>[] };
