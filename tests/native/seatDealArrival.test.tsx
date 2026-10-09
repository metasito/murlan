// tests/native/seatDealArrival.test.tsx — an opponent's hand is dealt to it
// card by card, and its badge counts only what has landed (#1102).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, within } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';

let mockReduce = false;
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => mockReduce,
  setMotionPreference: () => {},
  getMotionPreference: () => (mockReduce ? 'on' : 'off'),
}));

jest.mock('@/components/table/dealSlots', () => {
  const actual = jest.requireActual<typeof import('@/components/table/dealSlots')>('@/components/table/dealSlots');
  return { ...actual, __esModule: true, dealSlots: jest.fn(actual.dealSlots) };
});

import { dealSlots } from '@/components/table/dealSlots';
import { busiest } from './helpers/dealSweep';
import { along, freshDeal, frame, handPoses, table, type Pose } from './helpers/dealTable';
import { bootFeedback, startsOf } from './helpers/feedback';

const SEATS = ['top-seat', 'side-seat-left', 'side-seat-right'];
const counted = (testID: string) => {
  const badge = within(screen.getByTestId(testID)).queryByText(/^[0-9]+$/);
  return badge ? Number(badge.props.children) : 0;
};
const seated = () => SEATS.reduce((sum, id) => sum + counted(id), 0);

const backs = () => screen.queryAllByTestId('dealt-back').map((b) => getAnimatedStyle(b) as Pose);
const reach = (p: Pose) => Math.hypot(along(p, 'translateX'), along(p, 'translateY'));
const landedSince = (before: Pose[], after: Pose[]) =>
  after.filter((p, i) => before[i]?.opacity === 1 && (p.opacity !== 1 || reach(p) < reach(before[i]))).length;

describe("an opponent's hand arrives with the deal", () => {
  beforeEach(async () => {
    mockReduce = false;
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts at each seat exactly the backs whose flight has reached it, frame by frame', async () => {
    const r = await render(table());
    const legs = jest.mocked(dealSlots).mock.calls.at(-1)![0];
    expect(legs).toHaveLength(39);
    expect(backs()).toHaveLength(busiest(legs));
    expect(seated()).toBe(0);
    expect(startsOf('deal')).toEqual([]);

    let frames = 0;
    let sawCount = false;
    let arrived = 0;
    let before = backs();
    while (screen.queryAllByTestId('dealt-back').length > 0 && frames++ < 2000) {
      await frame();
      if (screen.queryAllByTestId('dealt-back').length === 0) break;
      arrived += landedSince(before, (before = backs()));
      expect(startsOf('deal')).toHaveLength(1);
      expect(seated()).toBe(arrived);
      sawCount ||= seated() > 0 && seated() < 39;
    }

    expect(sawCount).toBe(true);
    for (const id of SEATS) expect(counted(id)).toBe(13);
    await r.unmount();
  }, 20_000);

  it('keeps the landed count through a re-render of the table mid-deal', async () => {
    const r = await render(table());
    let frames = 0;
    while (seated() < 10 && frames++ < 2000) await frame();
    const before = seated();
    expect(before).toBeGreaterThan(0);

    await r.rerender(table());
    expect(seated()).toBeGreaterThanOrEqual(before);

    await r.unmount();
  });

  it("deals the viewer's hand only with the table's deal", async () => {
    const dealt = await render(table());
    await frame();
    expect(handPoses().some((p) => p.opacity !== 1)).toBe(true);
    await dealt.unmount();

    const resumed = await render(table({ ...freshDeal, firstPlayMade: true }));
    await frame();
    expect(backs()).toHaveLength(0);
    expect(handPoses()).toHaveLength(13);
    expect(handPoses().every((p) => p.opacity === 1)).toBe(true);
    await resumed.unmount();
  });

  it('seats every hand at once under reduced motion, and still sounds the deal', async () => {
    mockReduce = true;
    const r = await render(table());
    await frame();

    expect(within(screen.getByTestId('side-seat-left')).getByText('13')).toBeTruthy();
    expect(screen.queryAllByTestId('dealt-back').length).toBe(0);
    expect(startsOf('deal')).toHaveLength(1);

    await r.unmount();
  });
});
