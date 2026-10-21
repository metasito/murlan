// tests/native/tableReset.test.tsx — leaving a table leaves nothing of it.
//
// Every teardown runs the one reset, so a table played to its last round and
// then left reads exactly like a provider that never sat at one.
import { describe, it, expect } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from '@testing-library/react-native';

import { aThreePlayed, seat, state } from '../support/game';
import { ACTIVE_ROOM_KEY } from '@/lib/storageKeys';
import { renderAppHook } from './harness/renderApp';
import { room, roundOver, wire } from './harness/wire';
import type { FakeSocket } from './mocks/socketIo';
import { useOnlineGame } from './onlineSurface';

type OnlineGameContextValue = ReturnType<typeof useOnlineGame>;

let accounts = 0;
let live: FakeSocket;
let userId: string;
/** The provider on an account of its own, so its socket has no listeners from an earlier test. */
async function mount() {
  userId = `u${++accounts}`;
  const view = await renderAppHook(() => useOnlineGame(), { user: { id: userId, username: 'Ana' }, online: true, connected: true });
  live = view.socket();
  return view;
}
const emitted = () => live.sent.map((e) => ({ event: e.event, payload: e.args[0] }));
const seated = () => [{ seatIndex: 0, userId, username: 'Ana' }];

/** Everything a screen can read, without the actions and the socket's own state. */
function dataOf(value: OnlineGameContextValue) {
  const { connected: _connected, ownLink: _ownLink, pill: _pill, ...rest } = value;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function'));
}

/** A table played through a round: every field the table owns holds something. */
async function playARound() {
  const dealt = state({ players: [seat(0, [], { id: 'player_0', name: 'Ana' }), seat(1, [], { id: 'player_1', name: 'Besi' })], firstPlayMade: true, playedRanks: aThreePlayed() });
  await live.deliver('room:state', room({ roomId: 'R1', code: 'ABCD', hostUserId: userId, status: 'in_progress', maxPlayers: 2, players: seated() }));
  await live.deliver('game:state', wire(dealt, 0, { turnDeadlineMs: 1000, turnSecondsRemaining: 30 }), () => {});
  await live.deliver('game:notification', {
    type: 'afk',
    code: 'PLAYER_AFK_AUTO_PASS',
    params: { username: 'Ana' },
    message: 'Ana auto-passed',
  });
  await live.deliver('game:match_state', { target: 41, length: 'match', roundsPlayed: 1, scores: { player_0: 5 } });
  await live.deliver(
    'game:round_over',
    roundOver({ ...dealt, finishingOrder: ['player_0', 'player_1'] }, { player_0: 3 }, {
      totals: { player_0: 8 },
      matchOver: true,
      matchContinues: false,
      matchWinnerIds: ['player_0'],
      ratingDeltas: { [userId]: 14 },
      ratingsAfter: { [userId]: { rating: 1014, rounds: 3 } },
    })
  );
}

describe('a table torn down', () => {
  const TEARDOWNS: { what: string; run: (value: OnlineGameContextValue) => Promise<void>; differs: object }[] = [
    {
      what: 'left',
      run: async (value) => {
        await act(async () => value.leaveRoom());
      },
      differs: {},
    },
    {
      what: 'given up on by a rejoin',
      run: () => live.deliver('game:rejoin_failed', { code: 'GAME_NOT_FOUND', message: 'Game not found' }),
      differs: { rejoinFailed: true },
    },
  ];

  for (const { what, run, differs } of TEARDOWNS) {
    it(`when ${what} reads as a provider that never sat at one`, async () => {
      const { result, unmount } = await mount();
      const fresh = dataOf(result.current);
      const freshKeys = await AsyncStorage.getAllKeys();

      await playARound();
      expect(await AsyncStorage.getItem(ACTIVE_ROOM_KEY)).not.toBeNull();
      const played = dataOf(result.current);
      for (const field of [
        'autoPassed',
        'placementPoints',
        'ratingDeltas',
        'roundRecorded',
        'ratingsAfter',
        'matchState',
        'turnSeconds',
        'turnDeadlineMs',
      ]) {
        expect({ [field]: played[field] }).not.toEqual({ [field]: fresh[field] });
      }

      await run(result.current);

      expect(dataOf(result.current)).toEqual({ ...fresh, ...differs });
      expect(await AsyncStorage.getAllKeys()).toEqual(freshKeys);
      await unmount();
    });
  }
});

describe('a room code', () => {
  it('is sent in its one spelling, and a code that is none is not sent at all', async () => {
    const { result, unmount } = await mount();

    await act(async () => {
      result.current.joinRoom(' abcd ');
      result.current.spectateRoom('xy9z');
      result.current.joinRoom('ab');
      result.current.spectateRoom('no way!');
    });

    expect(emitted().filter((e) => e.event === 'room:join' || e.event === 'room:spectate')).toEqual([
      { event: 'room:join', payload: expect.objectContaining({ code: 'ABCD' }) },
      { event: 'room:spectate', payload: expect.objectContaining({ code: 'XY9Z' }) },
    ]);
    await unmount();
  });
});

describe('the listener effect', () => {
  it('subscribes once for the life of a socket, whatever the table does', async () => {
    const { result, unmount } = await mount();

    await playARound();
    await act(async () => result.current.spectateRoom('ABCD'));
    await act(async () => result.current.leaveRoom());
    await act(async () => {
      void result.current.joinRoom('ABCD');
    });
    await live.deliver('game:rejoin_failed', { code: 'GAME_NOT_FOUND', message: 'Game not found' });

    const EVENTS = ['game:state', 'room:state', 'game:rejoin_failed', 'room:error'];
    for (const event of EVENTS) {
      expect({ event, subscribed: live.subscriptions.get(event)?.on }).toEqual({ event, subscribed: 1 });
    }
    await unmount();
    for (const event of EVENTS) {
      expect({ event, unsubscribed: live.subscriptions.get(event)?.off }).toEqual({ event, unsubscribed: 1 });
    }
  });
});

describe('a room:error while a lobby rejoin is outstanding', () => {
  async function inALobbyRejoining(result: { current: OnlineGameContextValue }) {
    await live.deliver('room:state', room({ roomId: 'R1', code: 'ABCD', hostUserId: userId, maxPlayers: 2, players: seated() }));
    await live.deliver('game:match_state', { target: 41, length: 'match', roundsPlayed: 1, scores: { player_0: 5 } });
    await act(async () => {
      live.drop('transport close');
      live.open();
    });
    expect(emitted()).toContainEqual({ event: 'room:rejoin', payload: expect.objectContaining({ code: 'ABCD' }) });
    expect(result.current.matchState.target).toBe(41);
  }

  it('is the refusal of that rejoin, and resets the whole table', async () => {
    const { result, unmount } = await mount();
    const { error: _fresh, ...fresh } = dataOf(result.current);
    const freshKeys = await AsyncStorage.getAllKeys();
    await inALobbyRejoining(result);

    await live.deliver('room:error', { code: 'ROOM_FULL', message: 'Room is full' });

    const { error, ...rest } = dataOf(result.current);
    expect(rest).toEqual(fresh);
    expect(error).not.toBeNull();
    expect(await AsyncStorage.getAllKeys()).toEqual(freshKeys);
    await unmount();
  });

  it('answers a join sent since, which cancelled the rejoin, and resets nothing', async () => {
    const { result, unmount } = await mount();
    await inALobbyRejoining(result);
    await act(async () => {
      void result.current.joinRoom('WXYZ');
    });
    const { error: _before, ...before } = dataOf(result.current);

    await live.deliver('room:error', { code: 'ROOM_FULL', message: 'Room is full' });

    const { error, ...rest } = dataOf(result.current);
    expect(rest).toEqual(before);
    expect(error).not.toBeNull();
    await unmount();
  });
});
