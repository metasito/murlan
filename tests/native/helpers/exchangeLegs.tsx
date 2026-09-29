import { jest } from '@jest/globals';
import React, { useRef, useState } from 'react';
import { act } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import { ExchangeLegs, type RingFlash } from '@/components/table/ExchangeLegs';
import { NO_STAGES, tradeKey, type SeatGeometry, type TradeStages } from '@/components/flightPhysics';
import { arrangeOpponents } from '@/components/seatLayout';
import type { CardFrom } from '@/components/flightPose';
import type { ExchangeAnnounceData } from '@/lib/game/sharedGameFlow';
import type { Card, Player } from '@/lib/game/gameEngine';

export const card = (id: string, rank: Card['rank']): Card => ({ id, suit: 'clubs', rank, isJoker: false });

const players = ['Ana', 'Bea', 'Cai', 'Dua'].map((name, i) => ({ id: `p${i}`, name, type: 'ai', hand: [card(`h${i}`, '9')] }) as Player);

export const GEOMETRY: SeatGeometry = {
  viewerSeat: 0,
  players,
  opponents: arrangeOpponents(players, 0),
  scale: 1,
  windowWidth: 844,
  windowHeight: 390,
  tableLeft: 20,
  tableRight: 20,
  tableTop: 12,
  surplus: 0,
  bottomPad: 8,
  handCardH: 90,
};

export const trade = (over: Partial<ExchangeAnnounceData> = {}): ExchangeAnnounceData => ({
  winnerName: 'Ana',
  loserName: 'Bea',
  winnerIdx: 0,
  loserIdx: 1,
  bothJokersException: false,
  cardReceived: card('2_clubs', '2'),
  ...over,
});

/** The legs as GameTable holds them: the stages they report fed back in, as the table's state. */
export function Legs(props: {
  trade: ExchangeAnnounceData;
  viewerSeat?: number | null;
  go?: boolean;
  onStage?: (leg: string, stage: string) => void;
  onReady?: () => void;
  onDismiss?: () => void;
  holdMsOverride?: number;
  geometry?: SeatGeometry;
}) {
  const [stages, setStages] = useState<TradeStages>({ key: tradeKey(props.trade), ...NO_STAGES });
  const flash = useSharedValue<RingFlash>({ seq: 0, seat: -1 });
  const handOrigins = useRef(new Map<string, CardFrom>());
  return (
    <ExchangeLegs
      trade={props.trade}
      stages={stages}
      geometry={props.geometry ?? GEOMETRY}
      handOrigins={handOrigins}
      go={props.go ?? true}
      viewerSeat={props.viewerSeat === undefined ? 0 : props.viewerSeat}
      scale={1}
      flash={flash}
      onStage={(key, leg, stage) => {
        props.onStage?.(leg, stage);
        setStages((s) => ({ ...s, [leg]: stage }));
      }}
      onReady={() => {
        setStages((s) => ({ ...s, ready: true }));
        props.onReady?.();
      }}
      onDismiss={props.onDismiss ?? (() => {})}
      holdMsOverride={props.holdMsOverride}
    />
  );
}

/** Runs the frame clock `ms` forward, one 16 ms frame at a time. */
export async function frames(ms: number, each?: (t: number) => void): Promise<void> {
  for (let t = 16; t <= ms; t += 16) {
    await act(async () => jest.advanceTimersByTime(16));
    each?.(t);
  }
}
