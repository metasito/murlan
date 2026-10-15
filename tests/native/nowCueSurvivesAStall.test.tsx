// tests/native/nowCueSurvivesAStall.test.tsx — a cue meant for now reaches the engine as now, so
// the rest of its commit running long before event()'s flush cannot make it late; a contact-timed
// cue that is truly late is still dropped.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { act, render, renderHook } from '@testing-library/react-native';

let mockReduce = false;
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => mockReduce,
  setMotionPreference: () => {},
  getMotionPreference: () => (mockReduce ? 'on' : 'off'),
}));

import * as feedback from '@/lib/device/feedback';
import { useTableTimeline } from '@/components/table/tableTimeline';
import { LATE_SOUND_MS } from '@/lib/tokens';
import { bootFeedback, startsOf } from './helpers/feedback';
import { frame, table } from './helpers/dealTable';

const STALL_MS = 20;

function stallAfterEveryEvent(): void {
  const event = feedback.event;
  const clock = performance.now.bind(performance);
  let skew = 0;
  jest.spyOn(performance, 'now').mockImplementation(() => clock() + skew);
  jest.spyOn(feedback, 'event').mockImplementation((moments, at) => {
    event(moments, at);
    skew += STALL_MS;
  });
}

describe('a cue meant for now, its commit stalling before the flush', () => {
  beforeEach(async () => {
    mockReduce = false;
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
    stallAfterEveryEvent();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each(['pass', 'roundWon', 'turn'] as const)('still sounds a %s sent with no flight to wait for', async (kind) => {
    const { result, unmount } = await renderHook(() => useTableTimeline());
    await act(async () => {
      result.current.moment({ kind });
      result.current.flush();
    });
    expect(startsOf(kind === 'roundWon' ? 'round_win' : kind)).toHaveLength(1);
    await unmount();
  });

  it('still sounds a landing reported a little late', async () => {
    const { result, unmount } = await renderHook(() => useTableTimeline());
    await act(async () => {
      result.current.awaitFlight('k');
      result.current.moment({ kind: 'landing', cards: 2, bomb: false, mine: false });
      result.current.flush();
    });
    const reported = performance.now();
    await act(async () => result.current.flightStarted('k', reported - LATE_SOUND_MS / 2, reported + 100));
    expect(startsOf('combo')).toHaveLength(1);
    await unmount();
  });

  it('still sounds the deal under reduced motion', async () => {
    mockReduce = true;
    const r = await render(table());
    await frame();
    expect(startsOf('deal')).toHaveLength(1);
    await r.unmount();
  });

  it('drops a landing reported later than the timeline tolerates', async () => {
    const { result, unmount } = await renderHook(() => useTableTimeline());
    await act(async () => {
      result.current.awaitFlight('k');
      result.current.moment({ kind: 'landing', cards: 2, bomb: false, mine: false });
      result.current.flush();
    });
    const reported = performance.now();
    await act(async () => result.current.flightStarted('k', reported - LATE_SOUND_MS * 2, reported + 100));
    expect(startsOf('combo')).toEqual([]);
    await unmount();
  });

  it('still sounds a cue that was still ahead when sent', async () => {
    await act(async () => feedback.event([{ kind: 'turn' }], performance.now() + 2));
    expect(startsOf('turn')).toHaveLength(1);
  });

  it('sounds a tap and a cue that land in the same flush, each', async () => {
    const { result, unmount } = await renderHook(() => useTableTimeline());
    await act(async () => {
      result.current.moment({ kind: 'turn' });
      result.current.flush();
      feedback.event([{ kind: 'give' }]);
    });
    expect({ turn: startsOf('turn').length, give: startsOf('play').length }).toEqual({ turn: 1, give: 1 });
    await unmount();
  });

  it('drops a contact-timed cue given a time already past', async () => {
    await act(async () => feedback.event([{ kind: 'exchange' }], performance.now() - LATE_SOUND_MS));
    expect(startsOf('exchange')).toEqual([]);
  });
});
