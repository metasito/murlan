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
import { fireEvent, isHiddenFromAccessibility, render } from '@testing-library/react-native';
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
    const cta = r.getByLabelText(en['rules.startTutorialA11yLabel']);
    // Every descendant, not the copy alone: a glyph left in the tree is a stop
    // a reader walks past, and querying by string cannot see one.
    for (const child of cta.children) {
      if (typeof child === 'string') continue;
      expect(isHiddenFromAccessibility(child)).toBe(true);
    }
    expect(r.queryAllByText(en['rules.startTutorial'])).toHaveLength(0);
    await r.unmount();
  });

  it('is titled How to play, says what the tutorial is, and reads on underneath', async () => {
    const r = await mount();
    expect(r.getByText(en['rules.headerTitle'])).toBeTruthy();
    // Hidden on purpose — it is the control's own face — so the query has to
    // ask for it, but an orphaned key would still fail here.
    expect(
      r.getByText(en['rules.startTutorialSubtitle'], { includeHiddenElements: true })
    ).toBeTruthy();
    // The rank reference is the first thing under the offer. If it needed a
    // tap this query would find nothing.
    expect(r.getByText(en['rules.strengthSectionLabel'])).toBeTruthy();
    await r.unmount();
  });

  it('starts the tutorial', async () => {
    const r = await mount();
    await fireEvent.press(r.getByLabelText(en['rules.startTutorialA11yLabel']));
    expect(router.push).toHaveBeenCalledWith('/tutorial');
    await r.unmount();
  });
});

