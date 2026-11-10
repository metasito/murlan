// tests/native/fanGlossCycle.test.tsx — the fan's gloss is made transparent, never stopped, while the lamp moves
// (`GlossTracks.live`), so a CSS animation is not restarted at the settle and its place in the track stays the rig's.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';

import { FanGloss } from '@/components/table/FanGloss';
import { createGlossTracks } from '@/components/table/glossTrackStore';
import { restLight, snapOf } from '@/components/table/glossTrack';
import { restingLamp } from '@/components/table/lampRig';
import { bootFeedback } from './helpers/feedback';

beforeEach(async () => {
  jest.useFakeTimers();
  await bootFeedback();
});
afterEach(() => {
  jest.useRealTimers();
});

const cards = [0, 1, 2].map((i) => ({ x: i * 12 - 12, y: 4, rot: (i - 1) * 8 }));
const placed = cards.map((c) => ({ x: 437 + c.x, y: 60 + c.y, rot: c.rot }));

const mockAmbient = jest.fn();
jest.mock('@/lib/motion', () => {
  const actual = jest.requireActual('@/lib/motion') as typeof import('@/lib/motion');
  return {
    ...actual,
    ambient: (spec: Parameters<typeof actual.ambient>[0]) => {
      mockAmbient(spec);
      return actual.ambient(spec);
    },
  };
});

const props = { s: 1, placed, cards, box: { w: 80, h: 60 }, backScale: 0.5, tilt: {} };
const lamp = () => snapOf(restingLamp([437, 180, 1]), false);

describe('the fan\'s gloss through a glide', () => {
  it('stays drawn and on its tracks, and is only transparent while the lamp moves', async () => {
    mockAmbient.mockClear();
    const tracks = createGlossTracks(lamp(), makeMutable(restLight(lamp())));
    const covered = jest.fn();
    await render(<FanGloss tracks={tracks} {...props} onCover={covered} />);
    const root = () => StyleSheet.flatten(screen.getByTestId('card-gloss', { includeHiddenElements: true }).props.style);
    expect(covered).toHaveBeenLastCalledWith(true);
    expect(root().opacity).not.toBe(0);
    const started = mockAmbient.mock.calls.length;
    expect(started).toBe(3);
    expect(mockAmbient.mock.calls.every(([spec]) => (spec as { delay: number }).delay === 0)).toBe(true);

    await act(async () => tracks.update(null, true));
    expect(covered).toHaveBeenLastCalledWith(false);
    expect(root().opacity).toBe(0);
    expect(root().display).not.toBe('none');
    jest.advanceTimersByTime(3000);
    await act(async () => tracks.update(null, false));
    expect(covered).toHaveBeenLastCalledWith(true);
    expect(root().opacity).not.toBe(0);
    expect(mockAmbient.mock.calls.length).toBe(started);
  });

  it('is placed in the track where the rig is when the rig bakes anew', async () => {
    mockAmbient.mockClear();
    const tracks = createGlossTracks(lamp(), makeMutable(restLight(lamp())));
    await render(<FanGloss tracks={tracks} {...props} onCover={() => {}} />);
    mockAmbient.mockClear();
    jest.advanceTimersByTime(2500);
    await act(async () => tracks.update(lamp(), false));
    expect(mockAmbient.mock.calls.length).toBe(3);
    jest.advanceTimersByTime(700);
    await act(async () => tracks.update(null, true));
    await act(async () => tracks.update(null, false));
    expect(mockAmbient.mock.calls.length).toBe(3);
    expect(mockAmbient.mock.calls.map(([spec]) => Math.abs((spec as { delay: number }).delay))).toEqual([0, 0, 0]);
  });
});
