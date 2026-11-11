// tests/native/fanGlossCycle.test.tsx — the fan's gloss is held to the rig as the felt's end B is (`restEnds.steering`): moved to
// the rig's place when the page stalls, rebaked when the track runs out, made transparent and never stopped while the lamp moves.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';

import { FanGloss } from '@/components/table/FanGloss';
import { createGlossTracks } from '@/components/table/glossTrackStore';
import { DRIFT_CHECK_MS, DRIFT_PT, driftPt, endTrack, placeOf } from '@/components/table/restEnds';
import { restingLamp, MAX_DT, steppedLamp } from '@/components/table/lampRig';
import { bootFeedback } from './helpers/feedback';

beforeEach(async () => {
  css.none = false;
  (globalThis as { document?: unknown }).document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
  jest.useFakeTimers();
  await bootFeedback();
});
afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  jest.useRealTimers();
});

const cards = [0, 1, 2].map((i) => ({ x: i * 12 - 12, y: 4, rot: (i - 1) * 8 }));
const at = { x: 0, y: 0 };
const felt = { sx: 1, sy: 1, s: 1, kickAt: at, shakeAt: at };
const drawn = cards.map((c) => ({ cx: 437 + c.x, cy: 60 + c.y, w: 24, h: 34, rot: c.rot, back: true, lift: 0, glow: 0 }));

/** The animation's clock as CSS keeps it: `playing` seconds into its pass, moved only by the wall and by `steerAmbient`. */
const css = { playing: 0, steered: [] as number[], started: 0, none: false };
jest.mock('@/lib/motion', () => {
  const actual = jest.requireActual('@/lib/motion') as typeof import('@/lib/motion');
  return {
    ...actual,
    ambient: (spec: Parameters<typeof actual.ambient>[0]) => {
      css.started += 1;
      return actual.ambient(spec);
    },
    ambientPlace: () => (css.none ? null : css.playing),
    steerAmbient: (_: unknown, to: { place?: number; paused?: boolean }) => {
      if (to.place !== undefined) {
        css.playing = to.place;
        css.steered.push(to.place);
      }
    },
  };
});

const props = { felt, drawn, cards, box: { w: 80, h: 60 }, backScale: 0.5, tilt: {} };
const rested = () => {
  const lamp = makeMutable(restingLamp([437, 180, 1]));
  lamp.value.t = 12;
  lamp.value.ph = 1.1;
  return lamp;
};
const light = makeMutable({ lx: 437, ly: 140, level: 1, r: 1, t: 0 });
const root = () => StyleSheet.flatten(screen.getByTestId('card-gloss', { includeHiddenElements: true }).props.style);

describe('the fan\'s gloss against the rig', () => {
  it('is put where the rig is the frame it starts, and kept there through stalls under a second', async () => {
    css.playing = 0;
    css.steered = [];
    const lamp = rested();
    const tracks = createGlossTracks(steppedLamp(lamp), { rest: light, light: makeMutable(light.value), ends: makeMutable(0) }, lamp.get());
    await render(<FanGloss tracks={tracks} {...props} onCover={() => {}} />);
    const track = endTrack(lamp.get().ph, lamp.get().t);
    await act(async () => void jest.advanceTimersByTime(100));
    expect(css.steered.at(-1)).toBeCloseTo(0, 6);

    // Frames of 400 ms: the rig steps at most MAX_DT of each, the animation keeps the wall's clock.
    let worst = 0;
    for (let n = 0; n < 40; n++) {
      css.playing += 0.4;
      lamp.value.t += MAX_DT;
      await act(async () => void jest.advanceTimersByTime(400));
      worst = Math.max(worst, driftPt(track.sway, css.playing, placeOf(track, lamp.get().t)));
    }
    expect(css.steered.length).toBeGreaterThan(1);
    expect(worst).toBeLessThanOrEqual(DRIFT_PT + 0.5);
    expect(DRIFT_CHECK_MS).toBeLessThanOrEqual(400);
  });

  it('bakes anew before the track wraps, and at the settle', async () => {
    css.playing = 0;
    const lamp = rested();
    const tracks = createGlossTracks(steppedLamp(lamp), { rest: light, light: makeMutable(light.value), ends: makeMutable(0) }, lamp.get());
    await render(<FanGloss tracks={tracks} {...props} onCover={() => {}} />);
    await act(async () => void jest.advanceTimersByTime(100));
    const before = css.started;
    lamp.value.t += 29;
    css.playing = 29;
    await act(async () => void jest.advanceTimersByTime(DRIFT_CHECK_MS + 10));
    expect(css.started).toBeGreaterThan(before);
    expect(css.steered.at(-1)).toBeCloseTo(0, 6);
  });

  it('gives up a track that never starts, and the backs draw their own, rather than rebaking at every check', async () => {
    css.none = true;
    const lamp = rested();
    const tracks = createGlossTracks(steppedLamp(lamp), { rest: light, light: makeMutable(light.value), ends: makeMutable(0) }, lamp.get());
    const covered = jest.fn();
    await render(<FanGloss tracks={tracks} {...props} onCover={covered} />);
    await act(async () => void jest.advanceTimersByTime(1500));
    css.started = 0;
    await act(async () => void jest.advanceTimersByTime(3000));
    css.none = false;
    expect(css.started).toBe(0);
    expect(covered).toHaveBeenLastCalledWith(false);
    expect(root().opacity).toBe(0);
  });

  it('stays drawn through a glide, transparent, and is covered only while the lamp rests', async () => {
    const lamp = rested();
    const tracks = createGlossTracks(steppedLamp(lamp), { rest: light, light: makeMutable(light.value), ends: makeMutable(0) }, lamp.get());
    const covered = jest.fn();
    await render(<FanGloss tracks={tracks} {...props} onCover={covered} />);
    expect(covered).toHaveBeenLastCalledWith(true);
    expect(root().opacity).not.toBe(0);
    await act(async () => tracks.update(false));
    expect(covered).toHaveBeenLastCalledWith(false);
    expect(root().opacity).toBe(0);
    expect(root().display).not.toBe('none');
    lamp.value.t += 3;
    await act(async () => tracks.update(true));
    expect(covered).toHaveBeenLastCalledWith(true);
    expect(root().opacity).not.toBe(0);
    await act(async () => void jest.advanceTimersByTime(100));
    expect(css.steered.at(-1)).toBeCloseTo(0, 6);
  });
});
