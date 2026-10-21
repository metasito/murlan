// tests/native/signOutClearsQueryCache.test.tsx — the cached lists belong to
// one account and their keys do not say whose, so signing out empties them,
// and nothing refetches against the session that just died.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { queryClient as qc } from '@/lib/query-client';
import { renderApp } from './harness/renderApp';
import { httpRequests } from './mocks/http';

function Account() {
  return <Text>{useAuth().user?.id ?? 'signed out'}</Text>;
}

/** What the app's queries asked the server for; the boot check and the socket ticket are no query. */
const fetches = () =>
  httpRequests()
    .filter((r) => r.method === 'GET' && r.path !== '/api/auth/me')
    .map((r) => r.path);

describe('signing out', () => {
  it('empties the query cache once the account is gone, and fetches nothing', async () => {
    qc.setQueryData(['/api/friends/invites'], []);
    qc.setQueryData(['/api/friends'], [{ id: 'f1' }]);

    const view = await renderApp(<Account />, { user: { id: 'u1', username: 'Ana' } });
    expect(fetches()).toEqual([]);

    await view.signOut();

    expect(qc.getQueryCache().getAll()).toEqual([]);
    expect(fetches()).toEqual([]);
    await view.unmount();
  });

  it('keeps the cache of a visitor who was never signed in', async () => {
    qc.setQueryData(['/api/leaderboard'], [{ id: 'p1' }]);

    const view = await renderApp(<Account />);

    expect(qc.getQueryData(['/api/leaderboard'])).toEqual([{ id: 'p1' }]);
    await view.unmount();
  });
});
