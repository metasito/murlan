// tests/native/stateOrder.test.tsx — a table never goes back.
//
// Two instances can hand a client one table's states out of order, so each carries its owner's
// epoch and a counter; the provider applies one only above the last it applied for that table.
import { describe, it, expect, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';

import { seat, state } from '../support/game';
import { renderAppHook } from './harness/renderApp';
import { wire } from './harness/wire';
import type { FakeSocket } from './mocks/socketIo';
import { useOnlineGame } from './onlineSurface';

let accounts = 0;

async function mount() {
  const view = await renderAppHook(() => useOnlineGame(), { user: { id: `so${++accounts}`, username: 'Ana' }, online: true, connected: true });
  return { ...view, live: view.socket() as FakeSocket };
}

const table = state({ players: [seat(0, [], { id: 'player_0', name: 'Ana' }), seat(1, [], { id: 'player_1', name: 'Besi' })] });

/** A state of table `roomId` at `(epoch, seq)`, told apart by its pass count. */
const at = (epoch: number, seq: number, passCount: number, roomId = 'R1') =>
  wire({ ...table, passCount }, 0, { roomId, epoch, seq });

describe('game:state order', () => {
  it('keeps the newer of two states that arrive swapped', async () => {
    const { result, live } = await mount();
    await live.deliver('game:state', at(3, 11, 11), () => {});
    await live.deliver('game:state', at(3, 10, 10), () => {});
    expect(result.current.gameState?.passCount).toBe(11);
  });

  it('applies a new owner’s first state over the old owner’s last', async () => {
    const { result, live } = await mount();
    await live.deliver('game:state', at(3, 40, 40), () => {});
    await live.deliver('game:state', at(4, 1, 1), () => {});
    expect(result.current.gameState?.passCount).toBe(1);
    await live.deliver('game:state', at(3, 41, 41), () => {});
    expect(result.current.gameState?.passCount).toBe(1);
  });

  it('forgets the order when the room is left', async () => {
    const { result, live } = await mount();
    await live.deliver('game:state', at(3, 11, 11), () => {});
    await act(async () => result.current.leaveRoom());
    await live.deliver('game:state', at(3, 10, 10), () => {});
    expect(result.current.gameState?.passCount).toBe(10);
  });

  it('applies another table’s state whatever its order', async () => {
    const { result, live } = await mount();
    await live.deliver('game:state', at(9, 50, 50, 'R1'), () => {});
    await live.deliver('game:state', at(2, 1, 1, 'R2'), () => {});
    expect(result.current.gameState?.passCount).toBe(1);
  });

  it('keeps a table’s order across a visit to another', async () => {
    const { result, live } = await mount();
    await live.deliver('game:state', at(9, 50, 50, 'R1'), () => {});
    await live.deliver('game:state', at(2, 1, 1, 'R2'), () => {});
    await live.deliver('game:state', at(9, 49, 49, 'R1'), () => {});
    expect(result.current.gameState?.passCount).toBe(1);
  });

  it('acknowledges a state it drops, so it is not sent again', async () => {
    const { live } = await mount();
    await live.deliver('game:state', at(3, 11, 11), () => {});
    const ack = jest.fn();
    await live.deliver('game:state', at(3, 10, 10), ack);
    expect(ack).toHaveBeenCalled();
  });
});
