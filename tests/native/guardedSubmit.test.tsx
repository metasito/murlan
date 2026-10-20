// tests/native/guardedSubmit.test.tsx — react-native-web fires onSubmitEditing on every
// repeat of a held Enter while the field is readOnly, so `submit` is what refuses the repeats.
import { describe, it, expect } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { NativeSyntheticEvent, TextInputSubmitEditingEventData } from 'react-native';
import { useGuardedSubmit } from '@/lib/useGuardedSubmit';

const enter = {} as NativeSyntheticEvent<TextInputSubmitEditingEventData>;

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useGuardedSubmit', () => {
  it('a held return submits once, and the field is read-only until it settles', async () => {
    const pending = deferred();
    let runs = 0;
    const { result } = await renderHook(() =>
      useGuardedSubmit(() => {
        runs++;
        return pending.promise;
      }),
    );
    expect(result.current.field.editable).toBe(true);

    await act(async () => {
      result.current.field.onSubmitEditing?.(enter);
      result.current.field.onSubmitEditing?.(enter);
      result.current.field.onSubmitEditing?.(enter);
    });
    expect(runs).toBe(1);
    expect(result.current.busy).toBe(true);
    expect(result.current.field.editable).toBe(false);

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.field.editable).toBe(true);

    await act(async () => {
      result.current.field.onSubmitEditing?.(enter);
    });
    expect(runs).toBe(2);
  });

  it('a rejected run clears busy and reaches the caller', async () => {
    const pending = deferred();
    const { result } = await renderHook(() => useGuardedSubmit(() => pending.promise));

    let settled: Promise<void> | undefined;
    await act(async () => {
      settled = result.current.submit();
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      pending.reject(new Error('refused'));
      await expect(settled).rejects.toThrow('refused');
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.field.editable).toBe(true);
  });
});
