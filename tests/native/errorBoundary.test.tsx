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
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Try } from 'expo-router/build/views/Try';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorFallback } from '@/components/ErrorFallback';
import { routeErrorBoundary } from '@/components/RouteErrorBoundary';
import type { CrashScope } from '@/lib/crashedTable';
import { blankCommentsAndStrings, jsxTags } from '../helpers/sourceScan';
import { ACTIVE_ROOM_KEY, WAITING_ROOM_KEY } from '@/lib/storageKeys';
import { SettingsProvider } from '@/context/SettingsContext';
import { t } from '@/lib/i18n';
import { resetErrorReportingForTests } from '@/lib/errorReporting';

jest.mock('@/lib/query-client', () => ({
  apiRequest: jest.fn(() => Promise.resolve({ ok: true })),
  getApiUrl: () => 'http://localhost',
}));

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
const replace = (require('expo-router') as { router: { replace: jest.Mock } }).router.replace;

jest.mock('expo', () => ({ ...jest.requireActual<object>('expo'), reloadAppAsync: jest.fn() }));
const reloadAppAsync = (require('expo') as { reloadAppAsync: jest.Mock }).reloadAppAsync;

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
// property of how context/AppProviders.tsx is written, so it is checked by reading it —
// the same approach as tests/server/socketEvents.test.ts.
describe('context/AppProviders.tsx keeps the boundary inside SafeAreaProvider', () => {
  const tagsOf = (source: string) => jsxTags(blankCommentsAndStrings(source));
  const tags = tagsOf(readFileSync(join(__dirname, '..', '..', 'context', 'AppProviders.tsx'), 'utf8'));
  const opens = (name: string, of = tags) => of.filter((t) => t.name === name && !t.isClose);
  const at = (name: string, isClose: boolean) => tags.findIndex((t) => t.name === name && t.isClose === isClose);

  it('mounts one of each', () => {
    expect(opens('SafeAreaProvider')).toHaveLength(1);
    expect(opens('ErrorBoundary')).toHaveLength(1);
  });

  it('opens SafeAreaProvider first and closes it last', () => {
    expect(at('SafeAreaProvider', false)).toBeLessThan(at('ErrorBoundary', false));
    expect(at('ErrorBoundary', true)).toBeLessThan(at('SafeAreaProvider', true));
  });

  it('counts no boundary that is commented out or quoted', () => {
    const decoys = tagsOf(
      [
        '{/* <ErrorBoundary> */}',
        '// <ErrorBoundary>',
        'const s = "<ErrorBoundary>";',
        '<ErrorBoundary>{children}</ErrorBoundary>',
      ].join('\n')
    );
    expect(opens('ErrorBoundary', decoys)).toHaveLength(1);
  });
});

describe('the root boundary renders its fallback', () => {
  // The same nesting as context/AppProviders.tsx, pinned by the structural check above.
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
    <ErrorFallback error={new Error('boom')} resetError={() => {}} leaveTable={async () => {}} />
  );

  expect(view.getByText(t('errorFallback.title'))).toBeTruthy();
  expect(view.getByRole('button', { name: t('errorFallback.restart') })).toBeTruthy();

  await view.unmount();
});

const seedHandles = async () => {
  await AsyncStorage.setItem(ACTIVE_ROOM_KEY, 'room-1');
  await AsyncStorage.setItem(WAITING_ROOM_KEY, 'ABCD');
};
const handles = () => AsyncStorage.multiGet([ACTIVE_ROOM_KEY, WAITING_ROOM_KEY]);
const FORGOTTEN = [
  [ACTIVE_ROOM_KEY, null],
  [WAITING_ROOM_KEY, null],
];
const KEPT = [
  [ACTIVE_ROOM_KEY, 'room-1'],
  [WAITING_ROOM_KEY, 'ABCD'],
];

/** Records each intent and acknowledges it, as the server does. */
const mockEmitted: string[] = [];
const mockSocket = {
  timeout: () => ({
    emit: (event: string, _message: unknown, ack: (err: unknown, reply: unknown) => void) => {
      mockEmitted.push(event);
      ack(null, { ok: true });
    },
  }),
};
jest.mock('@/context/SocketContext', () => ({ useSocketConnection: () => mockSocket }));

const crashedRoute = (scope: CrashScope) => {
  const Boundary = routeErrorBoundary(scope);
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <Try catch={Boundary}>
        <Thrower />
      </Try>
    </SafeAreaProvider>
  );
};

// A table screen's throw has to stop below Auth, Socket and Game: the root
// boundary above them unmounts all three, and their remount rejoins the table.
describe('a table route has its own boundary', () => {
  beforeEach(() => {
    mockEmitted.length = 0;
    replace.mockReset();
    reloadAppAsync.mockReset();
    return AsyncStorage.clear();
  });

  it.each([
    [['app', '(online)', '_layout.tsx'], 'online'],
    [['app', 'game.tsx'], 'offline'],
  ])('%j exports the %s ErrorBoundary', (segments, scope) => {
    const source = readFileSync(join(__dirname, '..', '..', ...segments), 'utf8');
    expect(source).toContain(`export const ErrorBoundary = routeErrorBoundary("${scope}");`);
  });

  it('shows the fallback and reports, with the providers outside it still mounted', async () => {
    const outer = { mounts: 0, unmounts: 0 };
    function Outer({ children }: { children: React.ReactNode }) {
      React.useEffect(() => {
        outer.mounts += 1;
        return () => {
          outer.unmounts += 1;
        };
      }, []);
      return <>{children}</>;
    }
    const view = await render(<Outer>{crashedRoute('online')}</Outer>);

    expect(view.getByText(t('errorFallback.title'))).toBeTruthy();
    expect(outer).toEqual({ mounts: 1, unmounts: 0 });
    expect(apiRequest).toHaveBeenCalledWith(
      'POST',
      '/api/client-errors',
      expect.objectContaining({ message: 'boom' })
    );
    await view.unmount();
  });

  // The socket outlives the crash, so the server sees no disconnect: a seat still
  // held routes the next game:state straight back into the crash, and no bot
  // takes it over. Releasing it stops those states (tests/integration/gameplay.test.ts).
  it('online Continue releases the seat and forgets the table', async () => {
    await seedHandles();
    const view = await render(crashedRoute('online'));

    await fireEvent.press(view.getByRole('button', { name: t('errorFallback.continue') }));

    await waitFor(async () => expect(await handles()).toEqual(FORGOTTEN));
    expect(mockEmitted).toEqual(expect.arrayContaining(['room:leave', 'room:unspectate']));
    expect(replace).toHaveBeenCalledWith('/');
    await view.unmount();
  });

  it('online Restart releases and forgets before reloading', async () => {
    await seedHandles();
    let atReload: unknown[] = [];
    reloadAppAsync.mockImplementation(async () => {
      atReload = [[...mockEmitted], await handles()];
    });
    const view = await render(crashedRoute('online'));

    await fireEvent.press(view.getByRole('button', { name: t('errorFallback.restart') }));

    await waitFor(() => expect(reloadAppAsync).toHaveBeenCalled());
    await waitFor(() =>
      expect(atReload).toEqual([expect.arrayContaining(['room:leave', 'room:unspectate']), FORGOTTEN])
    );
    await view.unmount();
  });

  it('a Restart that cannot reload lands on / rather than retrying the crashed route', async () => {
    reloadAppAsync.mockImplementation(() => Promise.reject(new Error('no reload here')));
    const view = await render(crashedRoute('online'));

    await fireEvent.press(view.getByRole('button', { name: t('errorFallback.restart') }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    await view.unmount();
  });

  it('an offline crash keeps the online resume handles', async () => {
    await seedHandles();
    const view = await render(crashedRoute('offline'));

    await fireEvent.press(view.getByRole('button', { name: t('errorFallback.continue') }));

    expect(replace).toHaveBeenCalledWith('/');
    expect(mockEmitted).toEqual([]);
    expect(await handles()).toEqual(KEPT);
    await view.unmount();
  });
});

it('Continue leaves the crashed route before clearing the error', async () => {
  const calls: string[] = [];
  replace.mockImplementation(() => calls.push('replace'));
  const view = await render(
    <ErrorFallback
      error={new Error('boom')}
      resetError={() => calls.push('reset')}
      leaveTable={async () => {}}
    />
  );

  await fireEvent.press(view.getByRole('button', { name: t('errorFallback.continue') }));

  expect(replace).toHaveBeenCalledWith('/');
  expect(calls).toEqual(['replace', 'reset']);
  await view.unmount();
});
