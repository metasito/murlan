// tests/native/renameFailureCopy.test.tsx — the screen tells a taken name and
// an invalid one apart.
//
// `tests/renameCopy.test.ts` proves the sentences differ from each other in the
// catalogue; this proves the screen picks the right one. Both are needed: a
// `serverErrorMessage` that fell through to its fallback on every path would
// leave the catalogue test green and the player told "try again" four times,
// which is the failure that looks exactly like success.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

const mockRename = jest.fn<(username: string) => Promise<void>>();
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'Ana' },
    rename: (name: string) => mockRename(name),
    logout: async () => {},
  }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: false, isSuccess: true, refetch: jest.fn() }),
  useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }),
}));

import React from 'react';
import { render, act, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey, TranslationParams } from '@/shared/i18n';
import { ApiError } from '@/lib/apiError';
import { USERNAME_MAX, USERNAME_MIN } from '@/shared/username';

const ProfileScreen = require('@/app/(online)/profile').default as React.ComponentType;

const t = (key: string, params?: TranslationParams) =>
  translate(DEFAULT_LOCALE, key as TranslationKey, params);

const METRICS = {
  frame: { x: 0, y: 0, width: 800, height: 600 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

/**
 * Types `name` into the rename field, saves, and returns what the player is
 * shown.
 *
 * The field is driven through its own `onChangeText` rather than
 * `fireEvent.changeText`: the query returns the composite `TextInput`, whose
 * host child carries `onChange` and not `onChangeText`, so the library's helper
 * finds nothing to call and the draft never changes — silently, leaving a test
 * that submits the name already in the box.
 */
async function refusedWith(name: string): Promise<string> {
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ProfileScreen />
    </SafeAreaProvider>
  );
  await act(async () => {});

  try {
    fireEvent.press(view.getByTestId('btn-rename'));
    await act(async () => {});

    await act(async () => {
      view.getByTestId('input-rename').props.onChangeText(name);
    });
    await waitFor(() => expect(view.getByTestId('input-rename').props.value).toBe(name));

    await act(async () => {
      view.getByTestId('input-rename').props.onSubmitEditing();
    });
    await waitFor(() => expect(view.queryByTestId('rename-error')).not.toBeNull());
    return String(view.getByTestId('rename-error').props.children);
  } finally {
    view.unmount();
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRename.mockResolvedValue(undefined);
});

describe('a refused rename, as the player sees it', () => {
  it('names the rule a bad name broke without spending a request', async () => {
    expect(await refusedWith('ab')).toBe(t('profile.renameTooShort', { min: USERNAME_MIN }));
    expect(await refusedWith('ana besi')).toBe(t('profile.renameInvalidChars'));
    expect(await refusedWith('a'.repeat(USERNAME_MAX + 1))).toBe(
      t('profile.renameTooLong', { max: USERNAME_MAX })
    );
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('renders the server`s own reason for a name that is taken', async () => {
    mockRename.mockRejectedValue(
      new ApiError(409, { code: 'USERNAME_TAKEN', message: 'taken' }, '{"code":"USERNAME_TAKEN"}')
    );
    expect(await refusedWith('AnaBesi')).toBe(t('server.USERNAME_TAKEN'));
  });

  it('renders a different reason again when the budget is spent', async () => {
    mockRename.mockRejectedValue(
      new ApiError(429, { code: 'RENAME_RATE_LIMITED', message: 'slow down' }, '{}')
    );
    expect(await refusedWith('AnaBesi')).toBe(t('server.RENAME_RATE_LIMITED'));
  });

  // The floor. Each assertion above passes on its own if every path renders the
  // same sentence, so the last thing asked is whether they are the same.
  it('gives four refusals four different sentences', async () => {
    const invalid = await refusedWith('ana besi');

    mockRename.mockRejectedValue(new ApiError(409, { code: 'USERNAME_TAKEN', message: '' }, '{}'));
    const taken = await refusedWith('AnaBesi');

    mockRename.mockRejectedValue(new ApiError(429, { code: 'RENAME_RATE_LIMITED', message: '' }, '{}'));
    const limited = await refusedWith('AnaBesi');

    // Not an `ApiError` at all — a dropped connection, which must not borrow
    // any of the three sentences above.
    mockRename.mockRejectedValue(new TypeError('Network request failed'));
    const offline = await refusedWith('AnaBesi');

    expect(new Set([invalid, taken, limited, offline]).size).toBe(4);
    expect(offline).toBe(t('profile.renameFailed'));
  });
});
