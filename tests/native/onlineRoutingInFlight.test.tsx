// tests/native/onlineRoutingInFlight.test.tsx — what the table does while a
// navigation is still landing is judged once it lands.
//
// `useSegments` names the place a navigation left until the router arrives, so
// the router holds off judging that stale place. A table lost in that window
// must still be followed: skipped outright, it leaves the player on a game
// screen's spinner with nothing left to wait for.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
import { useOnlineConnection, useOnlineRoom } from '@/context/onlineGameHooks';
import { useOnlineRouting } from '@/context/useOnlineRouting';
import { state } from '../support/game';
import { renderAppHook } from './harness/renderApp';
import { room, wire } from './harness/wire';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockSegments = { now: ['(online)'] };

jest.mock('expo-router', () => ({
  router: { replace: (to: unknown) => mockReplace(to), push: (to: unknown) => mockPush(to), back: jest.fn() },
  useSegments: () => mockSegments.now,
}));

const useRouted = () => {
  useOnlineRouting();
  return { room: useOnlineRoom(), connection: useOnlineConnection() };
};

let accounts = 0;

describe('a table lost while the room is being replaced by the game', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockPush.mockClear();
    mockSegments.now = ['(online)'];
  });

  /** Seated in a room whose game starts, then `lose` takes the table before the game screen lands. */
  const startThenLose = async (lose: (view: Awaited<ReturnType<typeof mount>>) => Promise<void>) => {
    const view = await mount();
    await view.socket().deliver('room:state', room({ roomId: 'r1', hostUserId: view.userId }));
    expect(mockPush).toHaveBeenLastCalledWith('/(online)/room');
    mockSegments.now = ['(online)', 'room'];
    await view.rerender();
    await view.socket().deliver('game:state', wire(state(), 0), () => {});
    expect(mockReplace).toHaveBeenLastCalledWith('/(online)/game');

    await lose(view);
    mockSegments.now = ['(online)', 'game'];
    await view.rerender();
    return view;
  };
  const mount = async () => {
    const userId = `u${++accounts}`;
    const view = await renderAppHook(useRouted, { user: { id: userId, username: 'Ana' }, online: true, connected: true });
    return { ...view, userId };
  };

  it('leaves the game for the lobby once it lands', async () => {
    const view = await startThenLose(async ({ result }) => act(async () => result.current.room.leaveRoom()));

    expect(mockReplace).toHaveBeenLastCalledWith('/(online)');
    expect(mockReplace).toHaveBeenCalledTimes(2);

    await view.unmount();
  });

  it('acts on a refused rejoin before consuming it', async () => {
    const failedWhenReplaced: boolean[] = [];
    const view = await startThenLose(async (v) => {
      mockReplace.mockImplementation(() => failedWhenReplaced.push(v.result.current.connection.rejoinFailed));
      await v.socket().deliver('game:rejoin_failed', { code: 'ROOM_NOT_FOUND', message: 'That room has closed.' });
    });

    expect(mockReplace).toHaveBeenLastCalledWith('/(online)');
    expect(failedWhenReplaced.at(-1)).toBe(true);
    expect(view.result.current.connection.rejoinFailed).toBe(false);

    await view.unmount();
  });
});
