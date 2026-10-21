// tests/native/onlineCatchUp.test.tsx — another seat dropping or coming back is a notice, not this
// table replaying: every throw keeps the full flight while the notice is up.
import { afterEach, beforeEach, describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';
import { aThreePlayed, state } from '../support/game';
import { Reconnect } from '@/lib/tokens';
import { renderApp } from './harness/renderApp';
import { roundOver, wire } from './harness/wire';
import type { FakeSocket } from './mocks/socketIo';

const mockTableProps = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

const seat = (id: string, name: string): Player => ({ id, name, hand: [] as Card[], type: 'human' });
const midRound: GameState = state({
  players: [seat('player_0', 'Alice'), seat('player_1', 'Carl')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: false,
  finishingOrder: [],
  firstPlayMade: true,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: 'deal' },
});

jest.mock('@/components/GameTable', () => ({
  GameTable: (props: object) => {
    mockTableProps(props);
    return null;
  },
}));

const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType }).default;

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

/** Alice seated at `table`; `id` is a fresh account for a socket with no history. */
const mount = async (
  ui: React.ReactElement,
  { table = midRound, id = 'alice', connected = true }: { table?: GameState; id?: string; connected?: boolean } = {}
) => {
  const view = await renderApp(ui, { user: { id, username: 'Alice' }, online: true, connected });
  await view.socket().deliver('game:state', wire(table, 0), () => {});
  return view;
};

type Connection = { state: string; action?: { onPress: () => void } } | null;
const lastTable = () =>
  mockTableProps.mock.calls.at(-1)![0] as {
    ownLink: string;
    catchUp: boolean;
    connection: Connection;
    matchActions?: object;
    overlays: (veiled: object) => React.ReactNode;
  };

describe('the online table under a reconnect notice', () => {
  it('throws at the full flight while another seat is away', async () => {
    const view = await mount(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>
    );
    await view.socket().deliver('game:player_disconnected', {
      userId: 'carl',
      username: 'Carl',
      seatIndex: 1,
      code: 'NEWER_SERVER_NOTICE',
      message: 'Carl disconnected',
      params: { seconds: 30 },
    });
    expect(mockTableProps.mock.calls.at(-1)![0]).toMatchObject({ disconnectedSeats: { 1: { seconds: 30 } } });
    for (const [props] of mockTableProps.mock.calls) expect((props as { catchUp?: boolean }).catchUp ?? false).toBe(false);
    await view.unmount();
  });
});

/** The socket down for as long as the table waits before it stops waiting. */
async function giveUp(socket: FakeSocket) {
  await act(async () => socket.drop('transport close'));
  await act(async () => void jest.advanceTimersByTime(Reconnect.pillAfter));
  await act(async () => void jest.advanceTimersByTime(Reconnect.giveUp - Reconnect.pillAfter));
}

describe("the online table on the viewer's own link", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    mockTableProps.mockClear();
  });

  it('catches up from the drop through the first state after the way back, however late it lands', async () => {
    const screen = () => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>
    );
    const view = await mount(screen());
    const socket = view.socket();
    const at = async (link: string, change: () => void | Promise<void>) => {
      await act(async () => change());
      expect(lastTable().ownLink).toBe(link);
      return lastTable().catchUp;
    };
    expect(lastTable().catchUp).toBe(false);
    expect(await at('dropped', () => socket.drop('transport close'))).toBe(true);
    expect(await at('back', () => socket.open())).toBe(true);
    expect(lastTable()).toMatchObject({ ownLink: 'back', connection: { state: 'back' } });
    expect(await at('up', () => void jest.advanceTimersByTime(Reconnect.back))).toBe(true);
    expect(await at('up', () => socket.deliver('game:state', wire({ ...midRound, currentTurnIndex: 1 }, 0), () => {}))).toBe(true);
    expect(await at('up', () => socket.deliver('game:state', wire({ ...midRound }, 0), () => {}))).toBe(false);
    await view.unmount();
  });

  it('offers Riprova once given up, and Riprova retries the connection', async () => {
    const view = await mount(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>
    );
    await giveUp(view.socket());
    const { connection } = lastTable();
    expect(connection?.state).toBe('lost');
    view.socket().reset();
    connection?.action?.onPress();
    expect(view.socket().connect).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('keeps the lost link and its Riprova on the table over a finished match', async () => {
    const finished: GameState = { ...midRound, roundOver: true, finishingOrder: ['player_0', 'player_1'] };
    const view = await mount(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>,
      { table: finished }
    );
    await view.socket().deliver(
      'game:round_over',
      roundOver(finished, { player_0: 21 }, { matchOver: true, matchContinues: false, matchWinnerIds: ['player_0'] })
    );
    await giveUp(view.socket());
    const { connection, matchActions } = lastTable();
    expect(matchActions).toBeDefined();
    expect(connection?.state).toBe('lost');
    view.socket().reset();
    connection?.action?.onPress();
    expect(view.socket().connect).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('says it is reconnecting from the first frame for a socket that was never up', async () => {
    const view = await mount(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>,
      { id: 'alice-fresh-device', connected: false }
    );
    expect(lastTable()).toMatchObject({ ownLink: 'up', connection: { state: 'reconnecting' } });
    await view.unmount();
  });
});
