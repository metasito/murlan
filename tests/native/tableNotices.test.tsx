import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { NOTICE_GALLERY, type NoticeFixture } from '@/components/table/notices/gallery';
import { NOTICES, type NoticeKind } from '@/components/table/noticeModel';
import { GameTable } from '@/components/GameTable';
import { TurnChip } from '@/components/table/notices/hud';
import { CHIP_H } from '@/components/seatLayout';
import { CLOCK_RUNNING_OUT_SECONDS, urgentThresholdSeconds } from '@/components/turnTimerUi';
import { Colors, makeShadow, NoticePalette } from '@/lib/theme';
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
        const plates = screen.getAllByTestId(`notice-${kind}`, { includeHiddenElements: true });
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

describe('the turn pill', () => {
  const S = 1.2;
  const TODAY = {
    neutral: { lit: false, edge: Colors.goldBorder, label: Colors.textMuted, dot: Colors.textMuted, glow: null, dotGlow: null },
    lit: {
      lit: true,
      edge: Colors.goldStrong,
      label: Colors.goldLit,
      dot: Colors.goldLit,
      glow: makeShadow(Colors.goldLit, 0, 0, 0.32, 20 * S, 0),
      dotGlow: makeShadow(Colors.goldLit, 0, 0, 0.7, 9 * S, 0),
    },
  } as const;
  const tick = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
  };
  const drawn = () => {
    const hidden = { includeHiddenElements: true };
    const [plate] = screen.getAllByTestId('notice-turn', hidden);
    const colour = (text: string) => StyleSheet.flatten(screen.getByText(text, hidden).props.style).color;
    return {
      plate: StyleSheet.flatten(plate.props.style),
      dot: StyleSheet.flatten(within(plate).getByTestId('turn-chip-dot', hidden).props.style),
      label: colour('Your turn'),
      count: (n: number) => colour(String(n)),
    };
  };
  const pill = (lit: boolean) => (
    <TurnChip seconds={30} active resetKey="t" scale={S} lit={lit} chipText="Your turn" spokenSeat="" />
  );

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  for (const [tone, today] of Object.entries(TODAY)) {
    it(`paints today's ${tone} pill, its count gold until the urgent threshold and dim red after`, async () => {
      const r = await render(pill(today.lit));
      let d = drawn();
      expect(d.plate).toMatchObject({ height: CHIP_H(S), paddingHorizontal: 11 * S, gap: 7 * S, borderColor: today.edge });
      const glowKeys = (style: object) => Object.keys(style).filter((k) => /shadow|elevation/i.test(k));
      if (today.glow) expect(d.plate).toMatchObject(today.glow);
      else expect(glowKeys(d.plate)).toEqual([]);
      if (today.dotGlow) expect(d.dot).toMatchObject(today.dotGlow);
      else expect(glowKeys(d.dot)).toEqual([]);
      expect(d.dot).toMatchObject({ width: 6 * S, height: 6 * S, backgroundColor: today.dot });
      expect(d.label).toBe(today.label);
      expect(d.count(30)).toBe(Colors.gold);
      await tick(30 - urgentThresholdSeconds(30));
      d = drawn();
      expect(d.count(urgentThresholdSeconds(30))).toBe(Colors.dangerDim);
      expect(d.plate.borderColor).toBe(today.edge);
      await r.unmount();
    });
  }

  it("turns ember in the lit pill's last CLOCK_RUNNING_OUT_SECONDS, with #1265's colours", async () => {
    const r = await render(pill(true));
    await tick(30 - CLOCK_RUNNING_OUT_SECONDS);
    const d = drawn();
    expect(d.plate).toMatchObject({ borderColor: Colors.ember, ...makeShadow(Colors.emberGlow, 0, 0, 0.5, 18 * S, 0) });
    expect(d.dot).toMatchObject({ backgroundColor: Colors.emberDot, ...makeShadow(Colors.emberDot, 0, 0, 1, 9 * S, 0) });
    expect(d.label).toBe(Colors.emberLabel);
    expect(d.count(CLOCK_RUNNING_OUT_SECONDS)).toBe(Colors.emberCount);
    await r.unmount();
  });

  it('is the one notice plate in the HUD stack', async () => {
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameTable gameState={STATE} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
      </SafeAreaProvider>,
    );
    const stack = screen.getByTestId('game-hud-stack', { includeHiddenElements: true });
    const plates = within(stack).getAllByTestId('notice-turn', { includeHiddenElements: true });
    expect(plates).toHaveLength(1);
    expect(within(plates[0]).getAllByTestId('turn-chip-dot', { includeHiddenElements: true })).toHaveLength(1);
    await r.unmount();
  });
});
