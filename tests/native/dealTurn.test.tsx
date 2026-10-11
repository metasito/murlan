// tests/native/dealTurn.test.tsx — the viewer's turn is given when the deal lands, not from its first frame (#1432).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';

import { HAND_SCALE, HAND_SCALE_ON_TURN } from '@/components/cardFaceModel';
import { Colors, Motion } from '@/lib/theme';
import { en } from '@/locales/en';
import { advance, dealing, freshDeal, table } from './helpers/dealTurnTable';
import { bootFeedback, haptics } from './helpers/feedback';

let mockReduce = false;
jest.mock('@/lib/accessibility', () => ({
  ...jest.requireActual<typeof import('@/lib/accessibility')>('@/lib/accessibility'),
  usePrefersReducedMotion: () => mockReduce,
}));

const mockWindow = { width: 844, height: 390, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));

const HIDDEN_TOO = { includeHiddenElements: true };

const chipReadsYourTurn = () =>
  within(screen.getByTestId('game-hud-stack')).queryByText(en['gameShared.yourTurn'], HIDDEN_TOO) !== null;
const chipIsLit = () =>
  JSON.stringify(screen.getByTestId('turn-chip-dot', HIDDEN_TOO).props.style).includes(Colors.goldLit);
const giocaIsLit = () => {
  const label = within(screen.getByTestId('btn-gioca')).getByText(en['gameTable.playLabelGioca'], HIDDEN_TOO);
  return StyleSheet.flatten(label.props.style).color === Colors.bg;
};
const handCardW = () => {
  const [card] = screen.getAllByTestId(/^hand-card-/, HIDDEN_TOO);
  return StyleSheet.flatten(card.props.style).width as number;
};
const handCardScale = () => {
  const [card] = screen.getAllByTestId(/^hand-card-/, HIDDEN_TOO);
  const { transform = [] } = getAnimatedStyle(card) as { transform?: Record<string, number>[] };
  return transform.find((t) => 'scale' in t)?.scale ?? 1;
};
const chipReads = (key: keyof typeof en) => within(screen.getByTestId('game-hud-stack')).queryByText(en[key], HIDDEN_TOO) !== null;
const tableSays = (key: keyof typeof en) => JSON.stringify(screen.toJSON()).includes(en[key]);

describe("the viewer's turn waits for the deal to land", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
    mockReduce = false;
  });

  it('shows no turn while the cards fly, and gives it once they land', async () => {
    const view = await render(table(freshDeal()));
    await advance(400);
    expect(dealing()).toBe(true);
    expect(chipReadsYourTurn()).toBe(false);
    expect(chipIsLit()).toBe(false);
    expect(giocaIsLit()).toBe(false);
    expect(chipReads('gameShared.dealing')).toBe(true);
    expect(tableSays('gameTable.a11yYourTurn')).toBe(false);
    expect(JSON.stringify(screen.toJSON())).not.toContain(en['gameTable.a11yTurnOf'].replace('{{name}}', 'P0'));
    expect(haptics()).not.toContain('impactLight');
    const dealtW = handCardW();

    for (let ms = 0; dealing() && ms < 3000; ms += 160) await advance(160);
    expect(dealing()).toBe(false);
    expect(chipReadsYourTurn()).toBe(true);
    expect(chipIsLit()).toBe(true);
    expect(giocaIsLit()).toBe(true);
    expect(tableSays('gameTable.a11yYourTurn')).toBe(true);
    await advance(0);
    expect(haptics()).toContain('impactLight');
    expect(handCardW() / dealtW).toBeCloseTo(HAND_SCALE_ON_TURN / HAND_SCALE, 2);
    expect(handCardScale()).toBeLessThan(0.95);
    await advance(Motion.handResize + 32);
    expect(handCardScale()).toBeCloseTo(1, 2);
    await view.unmount();
  }, 20_000);

  it('with reduce motion on, the fan takes its turn size without travelling', async () => {
    mockReduce = true;
    const state = { ...freshDeal(), currentTurnIndex: 1 };
    const view = await render(table(state));
    for (let ms = 0; dealing() && ms < 3000; ms += 160) await advance(160);
    const waitingW = handCardW();
    await view.rerender(table({ ...state, currentTurnIndex: 0 }));
    expect(handCardW() / waitingW).toBeCloseTo(HAND_SCALE_ON_TURN / HAND_SCALE, 2);
    await advance(16);
    expect(handCardScale()).toBeCloseTo(1, 2);
    await view.unmount();
  }, 20_000);
});
