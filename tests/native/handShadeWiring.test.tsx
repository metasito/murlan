// tests/native/handShadeWiring.test.tsx — the hand's and pile's shadows on each other are drawn by one
// canvas over the table, from each one's own paint order: the order its card views stack in.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import type { HandShadeProps } from '@/components/table/feltReady';
import { dealCards, type GameState } from '@/lib/game/gameEngine';
import { Layer } from '@/lib/theme';
import { frames } from './helpers/exchangeLegs';
import { PAIR, throwPair } from './helpers/landing';
import { bootFeedback } from './helpers/feedback';

const HIDDEN = { includeHiddenElements: true };
const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const noop = () => {};
const mounted: HandShadeProps[] = [];

jest.mock('@/components/table/handShadeCanvas', () => {
  const { createElement } = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    HandShadeCanvas: (props: HandShadeProps) => {
      mounted.push(props);
      return createElement(View, { testID: 'hand-shade-canvas' });
    },
  };
});

function state(): GameState {
  const { hands } = dealCards(4);
  return {
    players: hands.map((hand, i) => ({ id: `p${i}`, name: `P${i}`, hand, type: 'human' as const })),
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: 'free_for_all',
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
  };
}

beforeEach(async () => {
  jest.useFakeTimers();
  await bootFeedback();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the hand shade', () => {
  it('is one canvas over the table, reading the hand in the order its card views stack', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameTable gameState={state()} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
      </SafeAreaProvider>
    );
    await frames(64);

    const canvas = screen.getByTestId('hand-shade-canvas', HIDDEN);
    const layer = StyleSheet.flatten(canvas.parent?.props.style) as { zIndex?: number };
    expect(layer.zIndex).toBe(Layer.cardShade);
    const props = mounted[mounted.length - 1];
    expect(props.ready).toBe(true);

    const stacked = screen
      .queryAllByTestId(/^hand-card-/, HIDDEN)
      .map((n) => ({ key: `hand:${String(n.props.testID).slice('hand-card-'.length)}`, z: (StyleSheet.flatten(n.props.style) as { zIndex: number }).zIndex }))
      .sort((a, b) => a.z - b.z)
      .map(({ key }) => key);
    expect(stacked.length).toBeGreaterThan(1);
    expect(props.cards.handOrder.value).toEqual(stacked);
  }, 60_000);

  it('reads the pile in the order its card views stack', async () => {
    await throwPair(3);
    const pileOrder = () => mounted[mounted.length - 1].cards.pileOrder.value;
    const shown = () => screen.container.queryAll((n) => typeof n.props.nativeID === 'string' && n.props.nativeID.startsWith('card-pile:')).map((n) => String(n.props.nativeID).slice('card-'.length));
    await frames(64);
    expect(shown()).toEqual(PAIR.cards.map((c) => `pile:${c.id}`));
    expect(pileOrder()).toEqual(shown());
    await frames(2000);
    expect(pileOrder()).toEqual(shown());
  }, 60_000);
});
