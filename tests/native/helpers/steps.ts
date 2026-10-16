import { jest } from '@jest/globals';
import { act } from '@testing-library/react-native';

/** Runs the clock `ms` forward a few frames per commit: for a test that reads state, not a frame's pose. */
export async function steps(ms: number, chunk = 100): Promise<void> {
  for (let t = 0; t < ms; t += chunk) await act(async () => jest.advanceTimersByTime(Math.min(chunk, ms - t)));
}
