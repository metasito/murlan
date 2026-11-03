// tests/native/handShadeAtRest.test.tsx — the hand shade is recorded once per hand layout and kick, never per lamp frame (#1962, rule 51).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';

import type { CardRect, CardRects } from '@/components/table/cardRects';
import { TABLE_AT_REST } from '@/components/table/cardRects';
import { HandShadeCanvas } from '@/components/table/handShadeCanvas';
import { TABLE_CENTRE, restingLamp, stepLamp } from '@/components/table/lampRig';
import type { CardTable } from '@/components/table/useCardRects';
import { frames } from './helpers/exchangeLegs';

const mock = { records: 0 };

jest.mock('@shopify/react-native-skia', () => {
  const R = require('react') as typeof import('react');
  const call: object = new Proxy(function () {}, { get: (_, key) => (key === 'then' ? undefined : call), apply: () => call });
  const element = ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children);
  const recorder = () => ({
    beginRecording: () => (mock.records++, call),
    finishRecordingAsPicture: () => ({ dispose: () => {} }),
    dispose: () => {},
  });
  const Skia = new Proxy(call, { get: (_, key) => (key === 'PictureRecorder' ? recorder : call) });
  return new Proxy({ Skia, PaintStyle: {}, useCanvasRef: () => R.useRef(null) } as Record<string | symbol, unknown>, {
    get: (known, key) => (key === '__esModule' ? true : key in known ? known[key] : element),
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  mock.records = 0;
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the hand shade at rest', () => {
  const rect = (over: Partial<CardRect> = {}): CardRect => ({ x: 200, y: 300, w: 64, h: 90, rot: 0, back: false, lift: 0, glow: 0, seen: 1, ...over });

  it('records nothing while the lamp sways and the hand holds still, and again when the table kicks', async () => {
    const rects = makeMutable<CardRects>({ 'hand:a': rect(), 'hand:b': rect({ x: 230 }) });
    const motion = makeMutable(TABLE_AT_REST);
    const at = { x: 0, y: 0 };
    const cards = { rects, handOrder: makeMutable<readonly string[]>(['hand:a', 'hand:b']), pileOrder: makeMutable<readonly string[]>([]), felt: { sx: 1, sy: 1, s: 1, kickAt: at, shakeAt: at }, motion, pile: at, hand: at, seats: {} } as unknown as CardTable;
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<HandShadeCanvas lamp={lamp} cards={cards} ready />);
    await frames(160);
    const settled = mock.records;
    expect(settled).toBeGreaterThan(0);
    await frames(1600, () =>
      lamp.modify((s) => {
        'worklet';
        stepLamp(s, 1 / 60, false);
        return s;
      }, true)
    );
    expect(mock.records).toBe(settled);
    motion.value = { ...TABLE_AT_REST, kx: 3 };
    await frames(160);
    expect(mock.records).toBeGreaterThan(settled);
    await view.unmount();
  });
});
