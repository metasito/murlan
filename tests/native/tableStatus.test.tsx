// tests/native/tableStatus.test.tsx — describeTableForA11y builds the whole
// spoken state of the table, and for as long as it existed it was attached to
// a layout container with no `accessible` and no role, which is an
// accessibility element on no platform. A blind player could hear their own
// cards and nothing else: not whose turn it is, not what is on the pile, not
// how many cards anyone holds.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/lib/sounds', () => ({
  playCardSelect: jest.fn(async () => {}),
  playCardPlay: jest.fn(async () => {}),
  playCardPass: jest.fn(async () => {}),
  playYourTurn: jest.fn(async () => {}),
  playRoundStart: jest.fn(async () => {}),
  playRoundWin: jest.fn(async () => {}),
  playUrgentTick: jest.fn(async () => {}),
  playBomb: jest.fn(async () => {}),
  playGameWin: jest.fn(async () => {}),
  playGameLose: jest.fn(async () => {}),
  playDeal: jest.fn(async () => {}),
  playExchange: jest.fn(async () => {}),
  preloadSounds: jest.fn(async () => {}),
  unloadSounds: jest.fn(() => {}),
  setSoundsMasterEnabled: jest.fn(() => {}),
  setSoundsMasterVolume: jest.fn(() => {}),
}));

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { GameTable } from '@/components/GameTable';
import type { Card, GameState, Player } from '@/lib/gameEngine';
import { it as itLocale } from '@/locales/it';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const card = (id: string, rank: Card['rank'], suit: Card['suit']): Card => ({
  id,
  rank,
  suit,
  isJoker: false,
});

const seat = (i: number, name: string): Player => ({
  id: `player_${i}`,
  name,
  hand: [card(`3_${i}`, '3', 'spades'), card(`4_${i}`, '4', 'clubs')],
  type: 'human',
});

const state = (currentTurnIndex: number): GameState => ({
  players: ['Ana', 'Besi', 'Cimi', 'Drin'].map((n, i) => seat(i, n)),
  currentTurnIndex,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
});

const noop = () => {};

const table = (gameState: GameState) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      viewerSeat={0}
      selectedIds={[]}
      onSelectCard={noop}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
      roundLabel="Partita"
    />
  </SafeAreaProvider>
);

const YOUR_TURN = itLocale['gameTable.a11yYourTurn'];

/**
 * The layout container keeps the same sentence as a raw attribute for the E2E
 * harness; only the node that is an accessibility element reaches a player.
 */
const spokenNodes = (pattern: RegExp) =>
  screen.getAllByLabelText(pattern).filter((n) => n.props.accessible === true);

describe('the table description reaches a screen reader', () => {
  it('is an accessibility element carrying the spoken state', async () => {
    const r = await render(table(state(0)));
    expect(spokenNodes(new RegExp(YOUR_TURN))).toHaveLength(1);
    await r.unmount();
  });

  it('announces itself when the turn changes rather than waiting to be found', async () => {
    const r = await render(table(state(0)));
    const [node] = spokenNodes(new RegExp(YOUR_TURN));
    expect(node.props.accessibilityLiveRegion).toBe('polite');
    await r.unmount();
  });

  it('summarises the hand on its own node', async () => {
    const r = await render(table(state(1)));
    expect(spokenNodes(/La tua mano/)).toHaveLength(1);
    await r.unmount();
  });
});
