// TEMPORARY — deleted before merge. One render per test.
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: {},
  NotificationFeedbackType: {},
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, rename: async () => {}, logout: async () => {} }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: false, isSuccess: true, refetch: jest.fn() }),
  useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }),
}));

import React from 'react';
import { render, act, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const ProfileScreen = require('@/app/(online)/profile').default as React.ComponentType;
const METRICS = {
  frame: { x: 0, y: 0, width: 800, height: 600 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function open() {
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ProfileScreen />
    </SafeAreaProvider>
  );
  await act(async () => {});
  fireEvent.press(view.getByTestId('btn-rename'));
  await act(async () => {});
  return view;
}

async function report(view: Awaited<ReturnType<typeof open>>, tag: string) {
  try {
    await waitFor(() => expect(view.queryByTestId('rename-error')).not.toBeNull(), { timeout: 1500 });
    console.log(`PROBE ${tag} -> ${view.getByTestId('rename-error').props.children}`);
  } catch {
    console.log(`PROBE ${tag} -> NO ERROR`);
  }
}

describe('probe', () => {
  it('A: fireEvent.changeText then fireEvent submitEditing', async () => {
    const view = await open();
    fireEvent.changeText(view.getByTestId('input-rename'), 'ab');
    await act(async () => {});
    console.log(`PROBE A value=${JSON.stringify(view.getByTestId('input-rename').props.value)}`);
    fireEvent(view.getByTestId('input-rename'), 'submitEditing');
    await act(async () => {});
    await report(view, 'A');
    expect(true).toBe(true);
  });

  it('B: fireEvent.changeText then press Save by role', async () => {
    const view = await open();
    fireEvent.changeText(view.getByTestId('input-rename'), 'ab');
    await act(async () => {});
    fireEvent.press(view.getByRole('button', { name: 'Save' }));
    await act(async () => {});
    await report(view, 'B');
    expect(true).toBe(true);
  });

  it('C: direct onChangeText in act then press Save by role', async () => {
    const view = await open();
    await act(async () => {
      view.getByTestId('input-rename').props.onChangeText('ab');
    });
    console.log(`PROBE C value=${JSON.stringify(view.getByTestId('input-rename').props.value)}`);
    fireEvent.press(view.getByRole('button', { name: 'Save' }));
    await act(async () => {});
    await report(view, 'C');
    expect(true).toBe(true);
  });
});
