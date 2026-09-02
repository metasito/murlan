// tests/native/orientationFirstRender.test.tsx — a menu decides portrait or
// landscape from useIsLandscape() at the top of its own render, so a wrong
// first value is a wrong first paint, not something a later effect quietly
// corrects underneath it (#819).
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

// iOS's own dimension bridge, cold: this is the shape #819 reported — a
// portrait phone whose first `Dimensions.get('window')` reads as landscape,
// and stays that way until an actual device rotation replaces it. Nothing in
// this file ever fires a `Dimensions` change event, on purpose: that event is
// exactly the thing the bug report says never arrives without a real
// rotation, so a fix that depended on it would pass this file for the wrong
// reason.
const WRONG_COLD_START = { width: 800, height: 400, scale: 2, fontScale: 1 };
const TRUE_PORTRAIT = { width: 400, height: 800 };

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => WRONG_COLD_START,
}));

import { OrientationProvider, useIsLandscape } from '@/lib/orientation';

function Probe() {
  return <Text testID="orientation-value">{String(useIsLandscape())}</Text>;
}

describe('useIsLandscape on the very first render', () => {
  it('reads landscape on mount when the window itself is misreported, then corrects from a real layout alone', async () => {
    const view = await render(
      <OrientationProvider>
        <Probe />
      </OrientationProvider>
    );

    // The unavoidable placeholder frame: nothing has measured anything real
    // yet, so this can only be whatever the window reported.
    expect(screen.getByTestId('orientation-value').props.children).toBe('true');

    // The device is actually in portrait. A real `onLayout` on the app's own
    // root reports it — and, unlike a `Dimensions` `change` event, this one
    // does not depend on the player ever rotating the device.
    await fireEvent(screen.getByTestId('orientation-root'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, ...TRUE_PORTRAIT } },
    });

    expect(screen.getByTestId('orientation-value').props.children).toBe('false');

    await view.unmount();
  });

  it('outside a provider, still answers from the window — an isolated caller keeps working', async () => {
    const view = await render(<Probe />);
    expect(screen.getByTestId('orientation-value').props.children).toBe('true');
    await view.unmount();
  });
});
