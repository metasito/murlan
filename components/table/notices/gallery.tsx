import type { ReactElement } from "react";
import type { KindTone, NoticeKind } from "../noticeModel";
import { HudComboPill, TurnChip } from "./hud";
import { WhoStartsCard } from "./panels";

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
  ],
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
} satisfies { [K in NoticeKind]: NoticeFixture<K>[] };
