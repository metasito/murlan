// tests/native/resultCutoutRail.test.tsx — the result screen reserves the
// cutout's own column, at the table's own width, on the table's own side.
//
// react-test-renderer runs no flexbox, so this cannot say where anything
// landed — tests/e2e/resultCutout.spec.ts is what measures that. What it can
// say is which numbers the board hands the layout: the rail's width, the edge
// it is pinned to, and the offset the body is pushed in by. A screen that
// reads the inset as plain padding hands out `leftPad` there instead, which is
// the defect (#816) and is exactly what these assertions separate.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const WINDOW = { width: 844, height: 390, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => WINDOW,
}));

// Pinned, not stubbed away: `railSideFor` is what turns a rotation into a side
// and it has its own boundary tests (tests/gameTableModel.test.ts). What this
// file is measuring is the column's width and the offset it buys, so the
// rotation has to hold still while it does.
jest.mock('expo-screen-orientation', () => ({
  Orientation: { LANDSCAPE_LEFT: 3 },
  getOrientationAsync: async () => 3,
  addOrientationChangeListener: () => ({ remove: () => {} }),
}));

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { ResultBoard, type ResultRow } from '@/components/ResultBoard';
import { cardScale, railWidth } from '@/components/gameTableModel';

/** An iPhone's Dynamic Island in landscape — past the rail's own floor. */
const ISLAND = 59;

const METRICS = {
  frame: { x: 0, y: 0, width: WINDOW.width, height: WINDOW.height },
  insets: { top: 0, left: ISLAND, right: 0, bottom: 21 },
};

const rows: ResultRow[] = [
  { id: 'player_0', name: 'Ana', total: 3, points: 3 },
  { id: 'player_1', name: 'Bea', total: 0, points: 0 },
];

async function mount(leftPad: number, rightPad: number) {
  return await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ResultBoard
        headerTitle="HAND OVER"
        formatLine="First to 21"
        celebratedName="Ana"
        celebrationSubtitle="WINS THE HAND"
        viewerCelebrated
        rows={rows}
        handCount={1}
        target={21}
        teams={false}
        home={{ label: 'Home', onPress: () => {}, testID: 'btn-home' }}
        topPad={0}
        bottomPad={21}
        leftPad={leftPad}
        rightPad={rightPad}
      />
    </SafeAreaProvider>
  );
}

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style) as Record<string, number | undefined>;

const railColumn = () =>
  railWidth(ISLAND, cardScale(Math.min(WINDOW.width, WINDOW.height)));

/** Whether `child` is anywhere under `parent` in the rendered tree. */
const within = (parent: unknown, child: unknown): boolean => {
  const node = child as { parent: unknown } | null;
  if (!node) return false;
  return node.parent === parent || within(parent, node.parent);
};

describe('the result screen under a cutout', () => {
  it('gives the cutout a rail of the table’s own width rather than padding the body by the raw inset', async () => {
    const view = await mount(ISLAND, 0);

    const rail = flat(screen.getByTestId('control-rail'));
    // The floor: a cutout under the rail's own width would make every
    // assertion below true of a board that had never read the inset at all.
    expect(railColumn()).toBeGreaterThan(ISLAND);
    expect(rail.width).toBe(railColumn());
    expect(rail.left).toBe(0);
    // Pinned to one edge: `left: 0` left standing beside `right: 0` would
    // stretch the column across the whole screen.
    expect(rail.right).toBeUndefined();

    await view.unmount();
  });

  it('pushes the body clear of the whole rail, not merely clear of the inset', async () => {
    const view = await mount(ISLAND, 0);

    // The winner column is the part the owner lost: it is the first thing in
    // the body, so the body's own offset decides whether it is covered.
    const body = flat(screen.getByTestId('result-body'));
    expect(body.marginLeft).toBe(railColumn());
    expect(body.marginRight).toBe(0);

    await view.unmount();
  });

  it('puts the screen’s exit in that column, so the cutout sits under a control', async () => {
    const view = await mount(ISLAND, 0);

    const knob = screen.getByTestId('btn-home');
    expect(knob.props.accessibilityLabel ?? knob.props['aria-label']).toBe('Home');
    // Inside the rail rather than merely present: a knob rendered anywhere
    // else leaves the column empty, which is the treatment #191 refuses.
    expect(within(screen.getByTestId('control-rail'), knob)).toBe(true);

    await view.unmount();
  });
});
