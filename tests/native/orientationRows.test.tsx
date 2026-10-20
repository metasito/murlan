import { afterEach, beforeAll, beforeEach, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { DiagRow } from '@/lib/diagnostics';
import { setWindow } from './harness/env';

const mockRows: DiagRow[] = [];
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => mockRows.push(row) } }));
const mockSnapshot = jest.fn(async (): Promise<Record<string, unknown>> => ({ keyWindow: false }));
jest.mock('@/modules/murlan-orientation', () => ({
  __esModule: true,
  default: { snapshot: () => mockSnapshot(), holdLandscape: async () => {}, release: async () => {} },
}));
let diagnostics: typeof import('@/lib/diagnostics');
beforeAll(() => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  diagnostics = require('@/lib/diagnostics');
});
beforeEach(() => {
  mockRows.length = 0;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

const seconds = (n: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(n * diagnostics.ORIENTATION_ROW_MS);
  });
const rows = () => mockRows.flatMap((r) => (r.k === 'orientation' ? [{ rn: r.rn, native: r.native, error: r.error }] : []));

beforeEach(() => setWindow({ width: 844, height: 390, scale: 2, fontScale: 1 }));

it("writes UIKit's view of the window once a second while the table is mounted, beside React Native's", async () => {
  const hook = await renderHook(({ w, h }: { w: number; h: number }) => diagnostics.useOrientationRows(w, h), { initialProps: { w: 390, h: 844 } });
  await seconds(2);
  await hook.rerender({ w: 844, h: 390 });
  await seconds(1);
  await hook.unmount();
  await seconds(3);
  const upright = { rn: { w: 390, h: 844 }, native: { keyWindow: false }, error: undefined };
  expect(rows()).toEqual([upright, upright, { ...upright, rn: { w: 844, h: 390 } }]);
});

it('a snapshot the native side refuses is still a row, carrying the refusal', async () => {
  mockSnapshot.mockRejectedValueOnce(new Error('no scene'));
  const hook = await renderHook(() => diagnostics.useOrientationRows(844, 390));
  await seconds(1);
  await hook.unmount();
  expect(rows()).toEqual([{ rn: { w: 844, h: 390 }, native: null, error: 'Error: no scene' }]);
});

it("the game table's landscape lock writes them, from the window it is laid out in", async () => {
  const { useLandscapeLock } = require('@/lib/device/orientation') as typeof import('@/lib/device/orientation');
  const hook = await renderHook(() => useLandscapeLock());
  await seconds(2);
  await hook.unmount();
  await seconds(2);
  const landscape = { rn: { w: 844, h: 390 }, native: { keyWindow: false }, error: undefined };
  expect(rows()).toEqual([landscape, landscape]);
});
