// tests/native/liveRegionsHelper.test.tsx — the finder four a11y files share.
// A region whose label is empty is the state they have to tell apart from no
// region at all, and it is the one `*ByLabelText` and `*ByRole` never match, so
// the helper is pinned against those queries rather than against itself.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { Text, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { a11yVeiled } from '@/lib/a11y';
import { isLiveRegion, liveRegions } from '../helpers/liveRegions';

const Region = ({ label, live }: { label: string; live?: 'aria' | 'native' }) => (
  <Text
    accessible
    accessibilityLabel={label}
    {...(live === 'aria'
      ? { 'aria-live': 'polite' as const }
      : { accessibilityLiveRegion: 'polite' as const })}
  />
);

describe('liveRegions', () => {
  it('finds a region whose label is empty, which the label query cannot', async () => {
    const r = await render(<Region label="" />);
    expect(screen.queryAllByLabelText(/.*/)).toHaveLength(0);
    expect(liveRegions(screen)).toHaveLength(1);
    await r.unmount();
  });

  it('finds both platforms spellings and nothing that is silent', async () => {
    const r = await render(
      <View>
        <Region label="android" live="native" />
        <Region label="web" live="aria" />
        <Text accessible accessibilityLabel="quiet" />
      </View>
    );
    expect(liveRegions(screen).map((n) => String(n.props.accessibilityLabel))).toEqual([
      'android',
      'web',
    ]);
    await r.unmount();
  });

  it('reports a veiled region, leaving reachability to the call site', async () => {
    const r = await render(
      <View {...a11yVeiled(true)}>
        <Region label="withdrawn" />
      </View>
    );
    expect(liveRegions(screen)).toHaveLength(1);
    await r.unmount();
  });

  it('shares its predicate, so a call site can partition instead of re-deriving', async () => {
    const r = await render(
      <View>
        <Region label="spoken" />
        <Text accessible accessibilityLabel="spoken" />
      </View>
    );
    const named = screen.queryAllByLabelText('spoken');
    expect(named.filter(isLiveRegion)).toHaveLength(1);
    expect(named.filter((n) => !isLiveRegion(n))).toHaveLength(1);
    await r.unmount();
  });
});
