import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { activate } from './tapHelpers';
import { t } from '@/lib/i18n';
import { cardSpokenName } from '@/lib/cardNames';

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

const mockNetListeners = new Set<(state: { isConnected: boolean | null }) => void>();
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (l: (state: { isConnected: boolean | null }) => void) => {
      mockNetListeners.add(l);
      return () => mockNetListeners.delete(l);
    },
  },
}));

import { NOTICE_GALLERY, type NoticeFixture } from '@/components/table/notices/gallery';
import { NOTICES, type NoticeKind } from '@/components/table/noticeModel';
import { GameTable } from '@/components/GameTable';
import { OfflineBanner } from '@/components/OfflineBanner';
import { en } from '@/locales/en';
import { SettingsProvider } from '@/context/SettingsContext';
import { TurnChip, type ConnectionNote } from '@/components/table/notices/hud';
import { CHIP_H } from '@/components/seatLayout';
import { CLOCK_RUNNING_OUT_SECONDS, urgentThresholdSeconds } from '@/components/turnTimerUi';
import { Colors, makeShadow, NoticePalette, TABLE_FONT_SCALE_MAX } from '@/lib/theme';
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

// No layout runs here: mockupPolish's 1.2x case measures the fit; this pins the two halves of it.
describe('the who-starts tile', () => {
  it('caps its rank like all table text, and grows to hold it rather than clipping', async () => {
    const r = await render(NOTICE_GALLERY.whoStarts[0].render(1));
    const tile = screen.getByTestId('notice-tile');
    const rank = within(tile).getByText('3');
    expect(rank.props.allowFontScaling).not.toBe(false);
    expect(rank.props.maxFontSizeMultiplier).toBe(TABLE_FONT_SCALE_MAX);
    const box = StyleSheet.flatten(tile.props.style);
    expect([box.width, box.height, box.overflow]).toEqual([undefined, undefined, undefined]);
    expect(box.minHeight).toBeGreaterThan(0);
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

describe('the turn pill', () => {
  const S = 1.2;
  const at = (px: number) => (px / (402 / 390)) * S;
  const TURN = {
    neutral: { lit: false, edge: Colors.goldBorder, label: Colors.textMuted, dot: Colors.gold, count: Colors.gold, glow: null, dotGlow: null },
    lit: {
      lit: true,
      edge: 'rgba(243,224,166,0.8)',
      label: Colors.goldLit,
      dot: Colors.goldLit,
      count: Colors.goldLit,
      glow: makeShadow(Colors.goldLit, 0, 0, 0.28, at(20.6), 0),
      dotGlow: makeShadow(Colors.goldLit, 0, 0, 1, at(6), 0),
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
    const style = (text: string) => StyleSheet.flatten(screen.getByText(text, hidden).props.style);
    return {
      plate: StyleSheet.flatten(plate.props.style),
      dot: StyleSheet.flatten(within(plate).getByTestId('turn-chip-dot', hidden).props.style),
      label: style('Your turn').color,
      labelSize: style('Your turn').fontSize,
      count: (n: number) => style(String(n)).color,
      countSize: (n: number) => style(String(n)).fontSize,
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

  for (const [tone, want] of Object.entries(TURN)) {
    it(`paints the ${tone} pill as #turn, its count in its ink until the urgent threshold and dim red after`, async () => {
      const r = await render(pill(want.lit));
      let d = drawn();
      expect(d.plate).toMatchObject({ height: CHIP_H(S), borderColor: want.edge });
      expect(d.plate.paddingHorizontal).toBeCloseTo(at(13));
      expect(d.plate.gap).toBeCloseTo(at(7));
      expect(d.labelSize).toBeCloseTo(at(10));
      expect(d.countSize(30)).toBeCloseTo(at(12));
      const glowKeys = (style: object) => Object.keys(style).filter((k) => /shadow|elevation/i.test(k));
      if (want.glow) expect(d.plate).toMatchObject(want.glow);
      else expect(glowKeys(d.plate)).toEqual([]);
      if (want.dotGlow) expect(d.dot).toMatchObject(want.dotGlow);
      else expect(glowKeys(d.dot)).toEqual([]);
      expect(d.dot).toMatchObject({ width: at(6), height: at(6), backgroundColor: want.dot });
      expect(d.label).toBe(want.label);
      expect(d.count(30)).toBe(want.count);
      await tick(30 - urgentThresholdSeconds(30));
      d = drawn();
      expect(d.count(urgentThresholdSeconds(30))).toBe(Colors.dangerDim);
      expect(d.plate.borderColor).toBe(want.edge);
      await r.unmount();
    });
  }

  it("turns ember in the lit pill's last CLOCK_RUNNING_OUT_SECONDS, with #1265's colours and glow", async () => {
    const r = await render(pill(true));
    await tick(30 - CLOCK_RUNNING_OUT_SECONDS);
    const d = drawn();
    expect(d.plate).toMatchObject({ borderColor: Colors.ember, ...makeShadow(Colors.emberGlow, 0, 0, 0.5, 18 * S, 0) });
    expect(d.dot).toMatchObject({ backgroundColor: Colors.emberDot, ...makeShadow(Colors.emberDot, 0, 0, 1, 9 * S, 0) });
    expect(d.label).toBe(Colors.emberLabel);
    expect(d.count(CLOCK_RUNNING_OUT_SECONDS)).toBe(Colors.emberCount);
    await r.unmount();
  });

  const connected = (state: ConnectionNote['state'], active = true) => (
    <TurnChip seconds={30} active={active} resetKey="t" scale={S} lit chipText="Your turn" spokenSeat="" connection={{ state, text: 'Note' }} />
  );
  for (const [state, edge, ink, dot, active] of [
    ['offline', Colors.offlineEdge, Colors.offlineInk, Colors.offlineDot, true],
    ['reconnected', Colors.onlineEdge, Colors.onlineInk, Colors.onlineDot, false],
    ['reconnecting', Colors.goldBorder, Colors.textMuted, Colors.gold, true],
  ] as const) {
    it(`carries the connection, ${state}, in place of the seat and its count`, async () => {
      const r = await render(connected(state, active));
      const hidden = { includeHiddenElements: true };
      const [plate] = screen.getAllByTestId('notice-turn', hidden);
      const dotStyle = StyleSheet.flatten(within(plate).getByTestId('turn-chip-dot', hidden).props.style);
      expect(StyleSheet.flatten(plate.props.style).borderColor).toBe(edge);
      expect(dotStyle.backgroundColor).toBe(dot);
      expect(StyleSheet.flatten(within(plate).getByText('Note', hidden).props.style).color).toBe(ink);
      expect(screen.queryByTestId('turn-chip-count', hidden)).toBeNull();
      expect(screen.queryByText('Your turn', hidden)).toBeNull();
      expect(dotStyle.opacity ?? 1).toBe(1);
      await r.unmount();
    });
  }

  it('turns bad on the table when the device goes offline, and reads the online screen\'s note otherwise', async () => {
    const table = (connection?: ConnectionNote) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameTable gameState={STATE} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} connection={connection} />
      </SafeAreaProvider>
    );
    const edge = () => StyleSheet.flatten(screen.getAllByTestId('notice-turn', { includeHiddenElements: true })[0].props.style).borderColor;
    const r = await render(table({ state: 'reconnected', text: 'Besi is back' }));
    expect(edge()).toBe(Colors.onlineEdge);
    await act(async () => mockNetListeners.forEach((l) => l({ isConnected: false })));
    expect(edge()).toBe(Colors.offlineEdge);
    await act(async () => mockNetListeners.forEach((l) => l({ isConnected: null })));
    expect(edge()).toBe(Colors.onlineEdge);
    await r.unmount();
  });

  it("gives way to the viewer's own running clock when another seat is back", async () => {
    const r = await render(connected('reconnected'));
    await tick(30 - CLOCK_RUNNING_OUT_SECONDS);
    const hidden = { includeHiddenElements: true };
    expect(screen.getByTestId('turn-chip-count', hidden)).toBeTruthy();
    expect(screen.queryByText('Note', hidden)).toBeNull();
    expect(StyleSheet.flatten(screen.getAllByTestId('notice-turn', hidden)[0].props.style).borderColor).toBe(Colors.ember);
    await r.unmount();
  });

  it('keeps the offline table on its clock when the device goes offline', async () => {
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameTable gameState={STATE} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
      </SafeAreaProvider>,
    );
    const edge = () => StyleSheet.flatten(screen.getAllByTestId('notice-turn', { includeHiddenElements: true })[0].props.style).borderColor;
    const before = edge();
    await act(async () => mockNetListeners.forEach((l) => l({ isConnected: false })));
    expect(edge()).toBe(before);
    await r.unmount();
  });

  it('leaves the offline note to the pill off the table while focus mode hides the turn pill', async () => {
    const hidden = { includeHiddenElements: true };
    const r = await render(
      <SettingsProvider>
        <SafeAreaProvider initialMetrics={METRICS}>
          <GameTable gameState={STATE} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} connection={null} />
          <OfflineBanner />
        </SafeAreaProvider>
      </SettingsProvider>,
    );
    const live = () => screen.getAllByTestId('offline-banner', hidden).at(-1)!.props.accessibilityLiveRegion;
    await act(async () => mockNetListeners.forEach((l) => l({ isConnected: false })));
    expect(live()).toBe('none');
    const knob = screen.getByLabelText(en['gameTable.settingsA11yLabel'], hidden);
    await act(async () => fireEvent.press(knob));
    await act(async () => fireEvent.press(screen.getByTestId(`settings-row-${en['gameSettingsSheet.focusMode']}`, hidden)));
    await act(async () => fireEvent.press(knob));
    expect(live()).toBe('assertive');
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

describe("the table's refusals and lines", () => {
  const hidden = { includeHiddenElements: true };
  const edge = (id: string) => StyleSheet.flatten(screen.getByTestId(id, hidden).props.style).borderColor;
  const said = (text: string) =>
    screen.getAllByRole('text', hidden).filter((n) => n.props.accessibilityLiveRegion === 'polite' && n.props.accessibilityLabel === text).length;
  const at = (state: GameState, error: string | null = null) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable gameState={state} viewerSeat={0} error={error} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
    </SafeAreaProvider>
  );
  const withAna = (over: Partial<Player>) => ({ ...STATE, players: STATE.players.map((p, i) => (i === 0 ? { ...p, ...over } : p)) });

  it('a refused GIOCA floats its reason in the bad tone, and the slot reads it out', async () => {
    const r = await render(at({ ...STATE, currentTurnIndex: 0 }));
    await act(async () => {
      await activate(screen.getByLabelText(cardSpokenName(card('3_0', '3', 'spades'), t)));
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('btn-gioca'));
    });
    expect(edge('notice-rejectFloat')).toBe(NoticePalette.float.bad.edge);
    expect(within(screen.getByTestId('notice-rejectFloat', hidden)).getByText(t('gameTable.playA11ySpokenTooLow'), hidden)).toBeTruthy();
    expect(said(t('gameTable.playA11ySpokenTooLow'))).toBe(1);
    await r.unmount();
  });

  it('a seat gone out waits for the others on a gold pill, in its own words', async () => {
    const r = await render(at(withAna({ hand: [], finishPosition: 1 })));
    expect(edge('notice-waitingOthers')).toBe(NoticePalette.pill.gold.edge);
    expect(within(screen.getByTestId('notice-waitingOthers', hidden)).getByText(t('gameTable.waitingOthers'), hidden)).toBeTruthy();
    await r.unmount();
  });

  it('an empty hand not yet out is the same gold pill', async () => {
    const r = await render(at(withAna({ hand: [] })));
    expect(edge('notice-emptyHand')).toBe(NoticePalette.pill.gold.edge);
    expect(within(screen.getByTestId('notice-emptyHand', hidden)).getByText(t('gameShared.emptyHand'), hidden)).toBeTruthy();
    await r.unmount();
  });

  it('an error arrives as the toast float in the bad tone, and the same error again floats again', async () => {
    const r = await render(at(STATE, 'Nope'));
    expect(edge('notice-errorToast')).toBe(NoticePalette.float.bad.edge);
    expect(said('Nope')).toBe(1);
    await r.rerender(at(STATE, null));
    expect(said('Nope')).toBe(0);
    await r.rerender(at(STATE, 'Nope'));
    expect(said('Nope')).toBe(1);
    expect(screen.getAllByTestId('notice-errorToast', hidden)).toHaveLength(1);
    await r.unmount();
  });
});
