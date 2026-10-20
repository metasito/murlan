// tests/native/orientationFirstRender.test.tsx — a menu decides portrait or
// landscape from useIsLandscape() at the top of its own render, so a wrong
// first value is a wrong first paint, not something a later effect quietly
// corrects underneath it (#819).
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

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

jest.mock('expo-screen-orientation', () => ({
  ...jest.requireActual<object>('expo-screen-orientation'),
  lockAsync: jest.fn(async () => {}),
  unlockAsync: jest.fn(async () => {}),
}));
const mockNative = { holdLandscape: jest.fn(async () => {}), release: jest.fn(async () => {}) };
jest.mock('@/modules/murlan-orientation', () => ({
  __esModule: true,
  default: { holdLandscape: () => mockNative.holdLandscape(), release: () => mockNative.release() },
}));

import * as ScreenOrientation from 'expo-screen-orientation';
import { OrientationProvider, useIsLandscape, useLandscapeLock } from '@/lib/device/orientation';

function Probe() {
  return <Text testID="orientation-value">{String(useIsLandscape())}</Text>;
}

function Locked() {
  useLandscapeLock();
  return null;
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

describe('useLandscapeLock', () => {
  it('locks on the first render, keeps asking while the measured window is upright (#1378), and lets go on unmount', async () => {
    jest.useFakeTimers();
    const locks = jest.mocked(ScreenOrientation.lockAsync);
    locks.mockClear();
    const view = await render(
      <OrientationProvider>
        <Locked />
      </OrientationProvider>
    );
    expect(locks).toHaveBeenCalledTimes(1);
    expect(locks).toHaveBeenLastCalledWith(ScreenOrientation.OrientationLock.LANDSCAPE);
    expect(mockNative.holdLandscape).toHaveBeenCalledTimes(1);

    await act(() => jest.advanceTimersByTime(3000));
    expect(locks).toHaveBeenCalledTimes(1);

    await fireEvent(screen.getByTestId('orientation-root'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, ...TRUE_PORTRAIT } },
    });
    const upright = locks.mock.calls.length;
    await act(() => jest.advanceTimersByTime(3000));
    expect(locks.mock.calls.length).toBe(upright + 3);

    expect(mockNative.release).not.toHaveBeenCalled();
    await view.unmount();
    expect(ScreenOrientation.unlockAsync).toHaveBeenCalledTimes(1);
    expect(mockNative.release).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
