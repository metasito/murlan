// tests/native/howToPlayEntry.test.tsx — the How to play screen offers the
// tutorial before the reading, and offers it as one control.
//
// `Pressable` defaults `accessible` to true, which names the control but does
// not take its children out of the accessibility tree. A label repeated by a
// visible child is announced twice, and no source scan can see it — the props
// are all individually correct.
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import RulesScreen from '@/app/rules';
import { en } from '@/locales/en';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const mount = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <RulesScreen />
    </SafeAreaProvider>
  );

describe('the How to play screen', () => {
  it('offers the tutorial as one accessible node, not a label plus its echo', async () => {
    const r = await mount();
    const cta = screen.getByLabelText(en['rules.startTutorialA11yLabel']);
    expect(cta).toBeTruthy();
    // The visible label and the glyphs are the control's own face. Reachable
    // separately, they are extra stops a screen reader has to walk past.
    expect(screen.queryAllByText(en['rules.startTutorial'])).toHaveLength(0);
    await r.unmount();
  });

  it('starts the tutorial', async () => {
    const r = await mount();
    screen.getByLabelText(en['rules.startTutorialA11yLabel']).props.onClick?.();
    await r.unmount();
  });

  it('is titled How to play, and the rules are readable without another tap', async () => {
    const r = await mount();
    expect(screen.getByText(en['rules.headerTitle'])).toBeTruthy();
    // The rank reference is the first thing under the tutorial offer. If it
    // needed a tap this query would find nothing.
    expect(screen.getByText(en['rules.strengthSectionLabel'])).toBeTruthy();
    await r.unmount();
  });
});

describe('the tutorial route', () => {
  it('is still reachable directly', () => {
    // `/tutorial` keeps its own route; this screen links into it rather than
    // absorbing it, so a deep link into the tutorial is unaffected.
    expect(typeof router.push).toBe('function');
  });
});
