import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { NOTICE_GALLERY, type NoticeFixture } from '@/components/table/notices/gallery';
import { NOTICES, type NoticeKind } from '@/components/table/noticeModel';
import { GameTable } from '@/components/GameTable';
import { NoticePalette } from '@/lib/theme';
import { buildCombination, type Card, type GameState, type Player } from '@/lib/game/gameEngine';

const KINDS = Object.keys(NOTICES) as NoticeKind[];
const fixtures = (kind: NoticeKind) => NOTICE_GALLERY[kind] as NoticeFixture[];
const edgeOf = (kind: NoticeKind, tone: string) =>
  (NoticePalette[NOTICES[kind].shape] as Record<string, { edge: string }>)[tone].edge;

describe('every notice kind paints one plate, in its tone', () => {
  it('the gallery holds a kind', () => {
    expect(KINDS.length).toBeGreaterThan(0);
  });

  for (const kind of KINDS) {
    for (const fixture of fixtures(kind)) {
      it(`${kind}: ${fixture.name}`, async () => {
        const r = await render(fixture.render(1));
        const plates = screen.getAllByTestId(`notice-${kind}`);
        expect(plates).toHaveLength(1);
        expect(StyleSheet.flatten(plates[0].props.style).borderColor).toBe(edgeOf(kind, fixture.tone));
        await r.unmount();
      });
    }

    it(`${kind}: the gallery covers every tone it declares`, () => {
      const shown = new Set(fixtures(kind).map((f) => f.tone));
      expect([...shown].sort()).toEqual([...NOTICES[kind].tones].sort());
    });
  }
});

// G1's `.tile` type is a fixed 13 px: a 22x30 face cannot take the OS text scale.
describe('the who-starts tile', () => {
  it('keeps its rank at the mockup size whatever the text setting', async () => {
    const r = await render(NOTICE_GALLERY.whoStarts[0].render(1));
    const rank = within(screen.getByTestId('notice-tile')).getByText('3');
    expect(rank.props.allowFontScaling).toBe(false);
    await r.unmount();
  });
});

const card = (id: string, rank: Card['rank'], suit: Card['suit']): Card => ({ id, rank, suit, isJoker: false });
const seat = (i: number, name: string): Player => ({
  id: `player_${i}`,
  name,
  hand: [card(`3_${i}`, '3', 'spades'), card(`4_${i}`, '4', 'clubs')],
  type: 'human',
});
const STATE: GameState = {
  players: ['Ana', 'Besi', 'Cimi', 'Drin'].map((n, i) => seat(i, n)),
  currentTurnIndex: 2,
  lastPlayedCombination: buildCombination([card('5_hearts', '5', 'hearts')]),
  lastPlayedBy: 1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
};
const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const noop = () => {};

describe('the HUD combination pill', () => {
  it('is a notice plate, the only one in the top bar', async () => {
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameTable gameState={STATE} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
      </SafeAreaProvider>,
    );
    const bar = screen.getByTestId('game-top-bar', { includeHiddenElements: true });
    const plates = within(bar).getAllByTestId('notice-hudCombo', { includeHiddenElements: true });
    expect(plates).toHaveLength(1);
    expect(StyleSheet.flatten(plates[0].props.style).borderColor).toBe(NoticePalette.pill.neutral.edge);
    await r.unmount();
  });
});
