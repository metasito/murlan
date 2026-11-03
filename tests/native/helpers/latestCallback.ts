import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useCountdown } from '@/components/table/countdown';
import { useRoundEnding } from '@/components/table/useRoundEnding';

type Fn = () => void;
type Landed = (at: number) => void;

/** A hook that keeps a caller's callback past the render that passed it calls the one the newest render passed. */
export function latestCallbackCases() {
  describe('a callback the table keeps past its render', () => {
    it("useCountdown's onExpire is the newest render's, when a resume ends a window that ran out under its hold", async () => {
      let t = 0;
      const now = () => t;
      const first = jest.fn<Fn>();
      const second = jest.fn<Fn>();
      const view = await renderHook(
        ({ held, onExpire }: { held: boolean; onExpire: Fn }) => useCountdown({ seconds: 1, resetKey: 'turn', running: true, held, onExpire, now }),
        { initialProps: { held: false, onExpire: first } }
      );
      t = 5_000;
      await act(async () => view.rerender({ held: true, onExpire: first }));
      expect(first).not.toHaveBeenCalled();
      await act(async () => view.rerender({ held: false, onExpire: second }));
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
      await view.unmount();
    });

    it("useCountdown's onExpire is the newest render's when its timer ends the window", async () => {
      jest.useFakeTimers();
      try {
        const first = jest.fn<Fn>();
        const second = jest.fn<Fn>();
        const view = await renderHook(
          ({ onExpire }: { onExpire: Fn }) => useCountdown({ seconds: 1, resetKey: 'turn', running: true, onExpire }),
          { initialProps: { onExpire: first } }
        );
        await act(async () => void jest.advanceTimersByTime(500));
        await act(async () => view.rerender({ onExpire: second }));
        await act(async () => void jest.advanceTimersByTime(500));
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        await view.unmount();
      } finally {
        jest.useRealTimers();
      }
    });

    it("useRoundEnding's onLanded is the newest render's when the landing starts the ending", async () => {
      const first = jest.fn<Landed>();
      const second = jest.fn<Landed>();
      const view = await renderHook(
        ({ landed, onLanded }: { landed: number | null; onLanded: Landed }) => useRoundEnding({ ended: true, landed, pileEmpty: false, onLanded }),
        { initialProps: { landed: null as number | null, onLanded: first } }
      );
      const landsAt = performance.now();
      await act(async () => view.rerender({ landed: landsAt, onLanded: second }));
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledWith(landsAt);
      await view.unmount();
    });
  });
}
