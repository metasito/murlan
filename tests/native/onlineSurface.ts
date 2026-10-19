// tests/native/onlineSurface.ts — the whole online surface, as the composition
// of the six slices, for tests that drive the real provider and read across
// them. A consumer of this wakes on any field, which is why no screen has one.
import { useMemo } from 'react';
import {
  useOnlineConnection,
  useOnlineExchange,
  useOnlineMatch,
  useOnlineRoom,
  useOnlineTable,
  useOnlineTurnClock,
} from '@/context/onlineGameHooks';

export function useOnlineGame() {
  const connection = useOnlineConnection();
  const room = useOnlineRoom();
  const table = useOnlineTable();
  const turnClock = useOnlineTurnClock();
  const match = useOnlineMatch();
  const exchange = useOnlineExchange();
  return useMemo(
    () => ({ ...connection, ...room, ...table, ...turnClock, ...match, ...exchange }),
    [connection, room, table, turnClock, match, exchange]
  );
}
