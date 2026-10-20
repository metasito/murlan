// tests/native/harnessEnv.test.tsx — each knob in ./harness/env moves what the app reads, and the
// next test starts from the default again. The second test reads what the first one left.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { Text, useWindowDimensions } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { usePrefersReducedMotion } from '@/lib/accessibility';
import { useDeviceOffline } from '@/components/OfflineBanner';
import { setConnectivity, setMotion, setWindow } from './harness/env';

function Probe() {
  const { width, height, fontScale } = useWindowDimensions();
  const reduced = usePrefersReducedMotion();
  const offline = useDeviceOffline();
  return <Text testID="probe">{JSON.stringify({ width, height, fontScale, reduced, offline })}</Text>;
}

const read = () => JSON.parse(String(screen.getByTestId('probe').props.children));
const DEFAULTS = { width: 844, height: 390, fontScale: 2, reduced: false, offline: false };

describe('the native test environment', () => {
  it('moves the window, the motion choice and connectivity under a mounted tree', async () => {
    const view = await render(<Probe />);
    expect(read()).toEqual(DEFAULTS);
    await setWindow({ width: 390, height: 844, fontScale: 1 });
    await setMotion('on');
    await setConnectivity(false);
    expect(read()).toEqual({ width: 390, height: 844, fontScale: 1, reduced: true, offline: true });
    await view.unmount();
  });

  it('starts the next test from the defaults', async () => {
    const view = await render(<Probe />);
    expect(read()).toEqual(DEFAULTS);
    await view.unmount();
  });
});
