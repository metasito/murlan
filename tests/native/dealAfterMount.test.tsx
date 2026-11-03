// tests/native/dealAfterMount.test.tsx — the deal's clock reads zero only after the commit that mounts the hand (#1964).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { makeMutable } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

const mockSeen: { clock: SharedValue<number> }[] = [];
jest.mock('@/components/table/deal', () => {
  const actual = jest.requireActual<typeof import('@/components/table/deal')>('@/components/table/deal');
  return {
    ...actual,
    __esModule: true,
    DealFlights: (props: React.ComponentProps<typeof actual.DealFlights>) => {
      mockSeen.push({ clock: props.clock });
      return require("react").createElement(actual.DealFlights, props);
    },
  };
});

import { GameTable } from '@/components/GameTable';
import { DealFlights } from '@/components/table/deal';
import { dealCards, emptyRankTally, type GameState, type Player } from '@/lib/game/gameEngine';
import { frames } from './helpers/exchangeLegs';
import { FRAME_MS } from './helpers/frames';
import { bootFeedback } from './helpers/feedback';

const freshDeal = (seats: number): GameState => ({
  players: dealCards(seats).hands.map((hand, i) => ({ id: `p${i}`, name: `P${i}`, hand, type: 'human' }) as Player),
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundOver: false,
  finishingOrder: [],
  openingCard: null,
  playedRanks: emptyRankTally(),
  lastMove: { seq: 0, kind: 'deal' },
});

const table = (gameState: GameState) => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } }}>
    <GameTable gameState={gameState} viewerSeat={0} onPlay={() => {}} onPass={() => {}} onQuit={() => {}} onExchangeGive={() => {}} />
  </SafeAreaProvider>
);

describe('the deal clock starts after the hand has mounted', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    mockSeen.length = 0;
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds at -1 until the hand card is on the table, then runs', async () => {
    const view = await render(table(freshDeal(4)));
    const clock = mockSeen.at(-1)!.clock;
    let handAtZero = -1;
    let zeroed = false;
    await frames(300, () => {
      if (zeroed || clock.value < 0) return;
      zeroed = true;
      handAtZero = screen.queryAllByTestId(/^hand-card-/).length;
    });
    expect(zeroed).toBe(true);
    expect(handAtZero).toBeGreaterThanOrEqual(13);
    await view.unmount();
  });

  it('waits for the hand while the clock is armed late, and ignores frames until then', async () => {
    const clock = makeMutable(-1);
    const armed = makeMutable(0);
    const view = await render(<DealFlights cards={[]} scale={1} clock={clock} armed={armed} startMs={0} endMs={1_000} onStarted={() => {}} onLanded={() => {}} />);
    await frames(FRAME_MS * 12);
    expect(clock.value).toBe(-1);
    armed.value = 1;
    await frames(FRAME_MS * 4);
    expect(clock.value).toBeGreaterThanOrEqual(0);
    await view.unmount();
  });
});
