// tests/native/tableStatus.test.tsx — describeTableForA11y builds the whole
// spoken state of the table: whose turn it is, what is on the pile, how many
// cards each seat holds. It has to reach an accessibility element, which a
// layout container with no `accessible` and no role is on no platform.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen, within } from '@testing-library/react-native';
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
import { buildCombination, type Card, type GameState, type Player } from '@/lib/gameEngine';
import { en as locale } from '@/locales/en';

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

const table = (gameState: GameState, spectating = false) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      viewerSeat={0}
      spectating={spectating}
      selectedIds={[]}
      onSelectCard={noop}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

/** Seat `by` has just led, so the next seat is on move. */
const led = (by: number): GameState => ({
  ...state((by + 1) % 4),
  lastPlayedCombination: buildCombination([card('5_hearts', '5', 'hearts')]),
  lastPlayedBy: by,
});

const YOUR_TURN = locale['gameTable.a11yYourTurn'];

/**
 * The layout container keeps the same sentence as a raw attribute for the E2E
 * harness; only the node that is an accessibility element reaches a player.
 */
const spokenNodes = (pattern: RegExp) =>
  screen.queryAllByLabelText(pattern).filter((n) => n.props.accessible === true);

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
    expect(spokenNodes(/Your hand/)).toHaveLength(1);
    await r.unmount();
  });
});

// The bottom seat belongs to someone else while spectating, so the seat the
// table is drawn from is nobody's own — a self form there names a play the
// watcher did not make.
describe('the top-left chip names who played', () => {
  it('uses the self form for the viewer', async () => {
    const r = await render(table(led(0)));
    const chip = within(screen.getByTestId('game-top-bar'));
    expect(chip.queryByText(locale['gameShared.you'])).not.toBeNull();
    await r.unmount();
  });

  it('names the seat rather than the watcher while spectating', async () => {
    const r = await render(table(led(0), true));
    const chip = within(screen.getByTestId('game-top-bar'));
    expect(chip.queryByText(locale['gameShared.you'])).toBeNull();
    expect(chip.queryByText('Ana')).not.toBeNull();
    await r.unmount();
  });
});

// A watcher is handed a seat so the table has a bottom to draw from, but the
// seat belongs to a real player they are not. Everything keyed off `isMyTurn`
// then addresses them as that player.
describe('a watcher is never the player on move', () => {
  const notStarted = (turn: number): GameState => ({
    ...state(turn),
    firstPlayMade: false,
    startCard: card('start', '3', 'spades'),
  });

  it.each([0, 1, 2, 3])('the turn chip never says YOUR TURN, at seat %i', async (turn) => {
    const r = await render(table(state(turn), true));
    const hud = within(screen.getByTestId('game-hud-stack'));
    expect(hud.queryByText(locale['gameShared.yourTurn'])).toBeNull();
    await r.unmount();
  });

  it('the spoken description does not open with your turn', async () => {
    const r = await render(table(state(0), true));
    expect(spokenNodes(new RegExp(YOUR_TURN))).toHaveLength(0);
    await r.unmount();
  });

  it('the start-card banner names the seat rather than the watcher', async () => {
    const r = await render(table(notStarted(0), true));
    expect(screen.queryByText(/You start!/)).toBeNull();
    expect(screen.queryByText(/Ana starts with/)).not.toBeNull();
    await r.unmount();
  });
});

// The same three, for the player whose seat it really is.
describe('a seated player is still the player on move', () => {
  it('the turn chip says YOUR TURN', async () => {
    const r = await render(table(state(0)));
    const hud = within(screen.getByTestId('game-hud-stack'));
    expect(hud.queryByText(locale['gameShared.yourTurn'])).not.toBeNull();
    await r.unmount();
  });

  it('the start-card banner uses the self form', async () => {
    const r = await render(
      table({ ...state(0), firstPlayMade: false, startCard: card('start', '3', 'spades') })
    );
    expect(screen.queryByText(/You start!/)).not.toBeNull();
    await r.unmount();
  });
});
