// tests/native/errorBoundary.test.tsx — the crash screen is the app's last
// resort, so it has to render under the two conditions that matter: inside the
// real provider stack, and with no SafeAreaProvider above it at all. A
// fallback that depends on a provider throws while rendering, and the throw
// lands on the next boundary up — of which the root boundary has none.
import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorFallback } from '@/components/ErrorFallback';
import { SettingsProvider } from '@/context/SettingsContext';
import { t } from '@/lib/i18n';
import { resetErrorReportingForTests } from '@/lib/errorReporting';

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
// The reporter deduplicates for ten seconds, and both cases below throw the
// same message from the same line — so without this the second render is
// correctly suppressed and reads as a broken test.
beforeEach(() => {
  apiRequest.mockClear();
  resetErrorReportingForTests();
});
afterAll(() => {
  consoleError.mockRestore();
});

// The rendering cases below build the stack themselves, which proves the
// fallback works in that shape but not that the app is in it. The ordering is a
// property of how app/_layout.tsx is written, so it is checked by reading it —
// the same approach as tests/socketEvents.test.ts.
describe('app/_layout.tsx keeps the boundary inside SafeAreaProvider', () => {
  const layout = readFileSync(join(__dirname, '..', '..', 'app', '_layout.tsx'), 'utf8');
  const occurrences = (tag: string) => layout.split(tag).length - 1;

  it('mounts one of each', () => {
    expect(occurrences('<SafeAreaProvider')).toBe(1);
    expect(occurrences('<ErrorBoundary')).toBe(1);
  });

  it('opens SafeAreaProvider first and closes it last', () => {
    expect(layout.indexOf('<SafeAreaProvider')).toBeLessThan(layout.indexOf('<ErrorBoundary'));
    expect(layout.indexOf('</ErrorBoundary>')).toBeLessThan(
      layout.indexOf('</SafeAreaProvider>')
    );
  });
});

describe('the root boundary renders its fallback', () => {
  // The same nesting as app/_layout.tsx, pinned by the structural check above.
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
      expect.objectContaining({
        message: 'boom',
        // The boundary is the only caller that has one, and #165's point is
        // that it now travels with the report.
        componentStack: expect.any(String),
      })
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
