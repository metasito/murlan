import type { ReactElement } from "react";
import type { KindTone, NoticeKind } from "../noticeModel";
import { HudComboPill, TurnChip } from "./hud";

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
} satisfies { [K in NoticeKind]: NoticeFixture<K>[] };
