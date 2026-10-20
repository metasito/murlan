import { jest } from '@jest/globals';
import React, { useRef, useState } from 'react';
import { act } from '@testing-library/react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { ExchangeLegs, type RingFlash } from '@/components/table/ExchangeLegs';
import { tableLayout, type Seating, type TableLayout } from '@/components/tableLayout';
import { NO_STAGES, exchangeKey, type ExchangeStages } from '@/components/table/exchangeModel';
import { arrangeOpponents } from '@/components/seatLayout';
import type { CardFrom } from '@/components/flightPose';
import type { ExchangeAnnounceData } from '@/lib/game/sharedGameFlow';
import type { Card, Player } from '@/lib/game/gameEngine';

export const card = (id: string, rank: Card['rank']): Card => ({ id, suit: 'clubs', rank, isJoker: false });

const players = ['Ana', 'Bea', 'Cai', 'Dua'].map((name, i) => ({ id: `p${i}`, name, type: 'bot', hand: [card(`h${i}`, '9')] }) as Player);

export const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };
export const LAYOUT: TableLayout = tableLayout({ width: 844, height: 390, insets: NO_INSETS, scale: 1 });
export const SEATING: Seating = { viewerSeat: 0, players, opponents: arrangeOpponents(players, 0) };

export const announced = (over: Partial<ExchangeAnnounceData> = {}): ExchangeAnnounceData => ({
  winnerName: 'Ana',
  loserName: 'Bea',
  winnerIdx: 0,
  loserIdx: 1,
  twoJokerException: false,
  cardReceived: card('2_clubs', '2'),
  ...over,
});

/** The legs as GameTable holds them: the stages they report fed back in, as the table's state. */
export function Legs(props: {
  announced: ExchangeAnnounceData;
  viewerSeat?: number | null;
  go?: boolean;
  onStage?: (leg: string, stage: string) => void;
  onReady?: () => void;
  onDismiss?: () => void;
  holdMsOverride?: number;
  layout?: TableLayout;
  lifted?: SharedValue<string[]>;
  /** False: the hand never draws a landed card, so its stage is not fed back. */
  handCommits?: boolean;
}) {
  const [stages, setStages] = useState<ExchangeStages>({ key: exchangeKey(props.announced), ...NO_STAGES });
  const flash = useSharedValue<RingFlash>({ seq: 0, seat: -1 });
  const ownLifted = useSharedValue<string[]>([]);
  const handOrigins = useRef(new Map<string, CardFrom>());
  return (
    <ExchangeLegs
      announced={props.announced}
      stages={stages}
      layout={props.layout ?? LAYOUT}
      seating={SEATING}
      handOrigins={handOrigins}
      go={props.go ?? true}
      viewerSeat={props.viewerSeat === undefined ? 0 : props.viewerSeat}
      scale={1}
      flash={flash}
      lifted={props.lifted ?? ownLifted}
      onStage={(key, leg, stage) => {
        props.onStage?.(leg, stage);
        if (stage !== 'landed' || props.handCommits !== false) setStages((s) => ({ ...s, [leg]: stage }));
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
