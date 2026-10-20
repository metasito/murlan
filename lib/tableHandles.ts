import AsyncStorage from "@react-native-async-storage/async-storage";
import { ACTIVE_ROOM_KEY, WAITING_ROOM_KEY } from "@/lib/storageKeys";
import type { WireRoomState } from "@/shared/protocol";

/**
 * What brings a player back to a table once the provider holding it is gone — a
 * cold start, or leaving the `(online)` group, which unmounts it. Two handles,
 * because they answer different questions: `roomId` asks `game:rejoin` for a live
 * game, `waitingCode` asks `room:rejoin` for a seat in a lobby. A waiting room has
 * no `active_games` row, so its id as `roomId` is a question the server can only
 * answer with a terminal rejoin failure.
 */
export interface TableHandles {
  roomId: string | null;
  waitingCode: string | null;
}

export function handlesFor(room: Pick<WireRoomState, "roomId" | "code" | "status">): TableHandles {
  return {
    roomId: room.status === "in_progress" ? room.roomId : null,
    waitingCode: room.status === "waiting" ? room.code : null,
  };
}

export async function readTableHandles(): Promise<TableHandles> {
  const [roomId, waitingCode] = await Promise.all([
    AsyncStorage.getItem(ACTIVE_ROOM_KEY),
    AsyncStorage.getItem(WAITING_ROOM_KEY),
  ]);
  return { roomId, waitingCode };
}

/** Writes only the handles named; a null removes one. */
export function storeTableHandles(next: Partial<TableHandles>): void {
  const write = (key: string, value: string | null | undefined) => {
    if (value === undefined) return;
    (value ? AsyncStorage.setItem(key, value) : AsyncStorage.removeItem(key)).catch(() => {});
  };
  write(ACTIVE_ROOM_KEY, next.roomId);
  write(WAITING_ROOM_KEY, next.waitingCode);
}

/** Both handles removed, resolved once storage has them gone. */
export async function forgetTableHandles(): Promise<void> {
  await AsyncStorage.multiRemove([ACTIVE_ROOM_KEY, WAITING_ROOM_KEY]).catch(() => {});
}

/** Whether a live game is waiting for this player — what home offers to resume. */
export async function holdsLiveTable(): Promise<boolean> {
  return !!(await AsyncStorage.getItem(ACTIVE_ROOM_KEY));
}
