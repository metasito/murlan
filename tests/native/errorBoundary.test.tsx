// tests/native/errorBoundary.test.tsx — the crash screen is the app's last
// resort, so it has to render under the two conditions that matter: inside the
// real provider stack, and with no SafeAreaProvider above it at all. The
// boundary previously sat outside SafeAreaProvider while its fallback called
// useSafeAreaInsets(), so every caught crash threw again with nothing above to
// catch it and the player saw a blank screen.
import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import React from 'react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorFallback } from '@/components/ErrorFallback';
import { SettingsProvider } from '@/context/SettingsContext';
import { t } from '@/lib/i18n';

// SettingsProvider reaches expo-audio through lib/sounds; the native module has
// no JS fallback under Jest.
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({ volume: 0, seekTo: jest.fn(), play: jest.fn(), remove: jest.fn() })),
  setAudioModeAsync: jest.fn(async () => {}),
}));

jest.mock('@/lib/query-client', () => ({
  apiRequest: jest.fn(() => Promise.resolve({ ok: true })),
  getApiUrl: () => 'http://localhost',
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const apiRequest = (require('@/lib/query-client') as { apiRequest: jest.Mock })
  .apiRequest;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Thrower(): React.ReactElement {
  throw new Error('boom');
}

// A caught render error is reported through console.error by React and by
// ErrorBoundary itself. Silencing it keeps a passing run readable.
const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
beforeEach(() => {
  apiRequest.mockClear();
});
afterAll(() => {
  consoleError.mockRestore();
});

describe('the root boundary renders its fallback', () => {
  // The same nesting as app/_layout.tsx: the boundary lives inside
  // SafeAreaProvider and wraps everything below it.
  const rootStack = (ui: React.ReactElement) => (
    <SettingsProvider>
      <QueryClientProvider client={new QueryClient()}>
        <SafeAreaProvider initialMetrics={METRICS}>
          <ErrorBoundary>
            <GestureHandlerRootView style={{ flex: 1 }}>{ui}</GestureHandlerRootView>
          </ErrorBoundary>
        </SafeAreaProvider>
      </QueryClientProvider>
    </SettingsProvider>
  );

  it('shows the crash screen and both recovery controls', async () => {
    const view = await render(rootStack(<Thrower />));

    expect(view.getByText(t('errorFallback.title'))).toBeTruthy();
    expect(view.getByRole('button', { name: t('errorFallback.restart') })).toBeTruthy();
    expect(view.getByRole('button', { name: t('errorFallback.continue') })).toBeTruthy();

    await view.unmount();
  });

  it('reports the crash to the server', async () => {
    const view = await render(rootStack(<Thrower />));

    expect(apiRequest).toHaveBeenCalledWith(
      'POST',
      '/api/client-errors',
      expect.objectContaining({ message: 'boom' })
    );

    await view.unmount();
  });
});

// The boundary is only genuinely last-resort if its fallback survives a crash
// in the providers above it — SafeAreaProvider included.
it('renders with no SafeAreaProvider anywhere', async () => {
  const view = await render(
    <ErrorFallback error={new Error('boom')} resetError={() => {}} />
  );

  expect(view.getByText(t('errorFallback.title'))).toBeTruthy();
  expect(view.getByRole('button', { name: t('errorFallback.restart') })).toBeTruthy();

  await view.unmount();
});
