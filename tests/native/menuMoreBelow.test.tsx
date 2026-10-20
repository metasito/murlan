// tests/native/menuMoreBelow.test.tsx — the "more below" fade follows the scroll, and a scroll
// that leaves it where it was renders nothing. Where it sits is tests/e2e/rulesScroll.spec.ts's.
import { describe, it, expect, beforeEach } from '@jest/globals';
import React, { Profiler } from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MenuLayout } from '@/components/MenuLayout';
import { setWindow } from './harness/env';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

beforeEach(() => setWindow({ width: 390, height: 844, scale: 2, fontScale: 1 }));

describe('MenuLayout', () => {
  it('shows the fade while content is left below, and re-renders only when that changes', async () => {
    let commits = 0;
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <Profiler id="menu" onRender={() => (commits += 1)}>
          <MenuLayout>
            <Text>content</Text>
          </MenuLayout>
        </Profiler>
      </SafeAreaProvider>
    );
    const scroll = screen.getByTestId('menu-content');
    const more = () => screen.queryByTestId('menu-more-below', { includeHiddenElements: true }) !== null;
    const scrollTo = (y: number) => fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 0, y } } });

    await fireEvent(scroll, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 800 } } });
    expect(more()).toBe(false);
    await fireEvent(scroll, 'contentSizeChange', 390, 2000);
    expect(more()).toBe(true);

    const before = commits;
    await scrollTo(100);
    await scrollTo(400);
    await scrollTo(900);
    expect(commits).toBe(before);
    expect(more()).toBe(true);

    await scrollTo(1200);
    expect(more()).toBe(false);
    expect(commits).toBe(before + 1);
    await view.unmount();
  });

  it('two measurements in one batch leave the fade where the second puts it', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <MenuLayout>
          <Text>content</Text>
        </MenuLayout>
      </SafeAreaProvider>
    );
    const scroll = screen.getByTestId('menu-content');
    const more = () => screen.queryByTestId('menu-more-below', { includeHiddenElements: true }) !== null;
    await fireEvent(scroll, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 800 } } });
    await act(() => {
      fireEvent(scroll, 'contentSizeChange', 390, 2000);
      fireEvent(scroll, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 2100 } } });
    });
    expect(more()).toBe(false);
    await view.unmount();
  });
});
