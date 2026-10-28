import type { ReactElement } from "react";
import { View } from "react-native";
import { SEAT_DISC } from "@/components/seatLayout";
import { START_CARD } from "@/lib/game/gameEngine";
import type { KindTone, NoticeKind } from "../noticeModel";
import { ErrorToast, PassFloat, RejectFloat } from "./floats";
import { EmptyHandLine, WaitingLine } from "./tableLines";
import { HudComboPill, OfflinePill, TurnChip } from "./hud";
import { EndMatchVote, LeftTable, RoundVote } from "./netNotes";
import { WhoStartsCard } from "./panels";
import { TrickWinnerMark } from "./pileNotices";
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
  frozen: true,
  resetKey: "gallery",
  chipText: lit ? "Your turn" : "Turn of Besnik",
  spokenSeat: "",
});

const vote = (voted: boolean, votes: number) => ({ voted, votes, total: 4, onPress: () => {} });

export type NoticeFixture<K extends NoticeKind = NoticeKind> = {
  name: string;
  tone: KindTone<K>;
  render: (scale: number) => ReactElement;
};

export const NOTICE_GALLERY = {
  hudCombo: [
    { name: "table clear", tone: "neutral", render: (scale) => <HudComboPill scale={scale} play={null} /> },
    { name: "a pair", tone: "neutral", render: (scale) => <HudComboPill scale={scale} play={{ name: "Besnik", combo: "Coppia" }} /> },
    {
      name: "an exchange's card resting on the pile",
      tone: "lit",
      render: (scale) => <HudComboPill scale={scale} play={null} note={{ text: "Luan dà 2♥ a Ana", testID: "exchange-pill-note" }} />,
    },
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
    {
      name: "given up",
      tone: "bad",
      render: (scale) => (
        <TurnChip {...turn(scale, true, 30)} connection={{ state: "lost", text: "Connection lost", action: { label: "Retry", onPress: () => {} } }} />
      ),
    },
  ],
  offline: [{ name: "off the table", tone: "solid", render: (scale) => <OfflinePill scale={scale} /> }],
  leftTable: [
    {
      name: "the vote deadline gave your seat to a bot",
      tone: "neutral",
      render: (scale) => <LeftTable scale={scale} live reclaiming={false} onReclaim={() => {}} onLeave={() => {}} />,
    },
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
          reason={{ type: "start_card", card: START_CARD, playerIdx: 0 }}
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
  trickWinner: [{ name: "a seat took the round", tone: "lit", render: (scale) => <TrickWinnerMark scale={scale} name="Besnik" /> }],
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
  endMatchVote: [
    { name: "a seat left, no votes", tone: "neutral", render: (scale) => <EndMatchVote {...vote(false, 0)} scale={scale} /> },
    { name: "another seat voted", tone: "neutral", render: (scale) => <EndMatchVote {...vote(false, 1)} scale={scale} /> },
    { name: "you voted", tone: "lit", render: (scale) => <EndMatchVote {...vote(true, 2)} scale={scale} /> },
  ],
  roundVote: [
    { name: "the round is over", tone: "neutral", render: (scale) => <RoundVote {...vote(false, 0)} scale={scale} /> },
    { name: "another seat is ready", tone: "neutral", render: (scale) => <RoundVote {...vote(false, 1)} scale={scale} /> },
    { name: "you are ready", tone: "lit", render: (scale) => <RoundVote {...vote(true, 2)} scale={scale} /> },
  ],
} satisfies { [K in NoticeKind]: NoticeFixture<K>[] };
