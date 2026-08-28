// TEMPORARY — deleted before merge. Which fireEvent path drives the rename
// control end to end?
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

describe('probe', () => {
  it('reports which path works', async () => {
    const results: string[] = [];

    // A: fireEvent.changeText, then fireEvent submitEditing
    {
      const view = await open();
      fireEvent.changeText(view.getByTestId('input-rename'), 'ab');
      await act(async () => {});
      results.push(`A changeText -> value=${JSON.stringify(view.getByTestId('input-rename').props.value)}`);
      fireEvent(view.getByTestId('input-rename'), 'submitEditing');
      await act(async () => {});
      try {
        await waitFor(() => expect(view.queryByTestId('rename-error')).not.toBeNull(), { timeout: 1500 });
        results.push(`A submitEditing -> ${view.getByTestId('rename-error').props.children}`);
      } catch {
        results.push('A submitEditing -> NO ERROR');
      }
    }

    // B: fireEvent.changeText, then press Save by role
    {
      const view = await open();
      fireEvent.changeText(view.getByTestId('input-rename'), 'ab');
      await act(async () => {});
      fireEvent.press(view.getByRole('button', { name: 'Save' }));
      await act(async () => {});
      try {
        await waitFor(() => expect(view.queryByTestId('rename-error')).not.toBeNull(), { timeout: 1500 });
        results.push(`B saveByRole -> ${view.getByTestId('rename-error').props.children}`);
      } catch {
        results.push('B saveByRole -> NO ERROR');
      }
    }

    // C: direct onChangeText inside act, then press Save by role
    {
      const view = await open();
      await act(async () => {
        view.getByTestId('input-rename').props.onChangeText('ab');
      });
      results.push(`C direct -> value=${JSON.stringify(view.getByTestId('input-rename').props.value)}`);
      fireEvent.press(view.getByRole('button', { name: 'Save' }));
      await act(async () => {});
      try {
        await waitFor(() => expect(view.queryByTestId('rename-error')).not.toBeNull(), { timeout: 1500 });
        results.push(`C saveByRole -> ${view.getByTestId('rename-error').props.children}`);
      } catch {
        results.push('C saveByRole -> NO ERROR');
      }
    }

    console.log('PROBE ' + results.join(' | '));
    expect(true).toBe(true);
  });
});
