import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { send } from "@/lib/sendIntent";
import type { Socket } from "@/lib/socket";
import { readTableHandles, storeTableHandles, type TableHandles } from "@/lib/tableHandles";
import type { GameState } from "@/lib/game/gameEngine";
import type { WireRoomState } from "@/shared/protocol";

// A SERVER_ERROR rejoin failure is the server handler's blanket catch, not a
// verdict on the table, so it is retried rather than treated as terminal. The
// cap keeps the retries well inside the server's 20-per-60s rejoin limit,
// past which the reply would be a `game:error` this path does not listen for.
export const REJOIN_RETRY_DELAY_MS = 2000;
export const MAX_REJOIN_RETRIES = 3;

// The `room:rejoin` rejections that mean the seat is gone for good (see the
// handler in server/socket/socketRooms.ts). `room:error` carries no room id, so the code is
// the only thing that separates the answer to an outstanding rejoin from an
// error about an action inside a room the player is still sitting in — and only
// the first may take the lobby down with it.
const TERMINAL_ROOM_REJOIN_CODES = new Set([
  "ROOM_NOT_FOUND",
  "NOT_IN_ROOM",
  "GAME_ALREADY_STARTED",
  "ROOM_FULL",
  "SEAT_HELD",
  "INVALID_PAYLOAD",
]);

export interface Rejoin {
  /**
   * Asks the server for whatever the table still holds: a live game, or a seat
   * in a waiting lobby. Returns whether anything was sent — an in-progress room
   * with no game state matches no branch, and a caller waiting for a reply has
   * to know it will never come.
   */
  attempt(): boolean;
  /** Live state arrived: nothing is outstanding, and no reply may act. */
  answered(): void;
  hold(next: Partial<TableHandles>): void;
  /** The table is gone: no handle may bring it back, and nothing is outstanding. */
  release(): void;
  /** Whether a `game:rejoin_failed` naming `roomId` answers the attempt still outstanding. */
  answers(roomId: string | undefined): boolean;
  /**
   * Schedules another attempt after a SERVER_ERROR. False once the cap is spent;
   * `onNothingSent` runs if the retry finds nothing left to ask for.
   */
  retry(onNothingSent: () => void): boolean;
  /** Whether a `room:error` with `code` is the refusal of the outstanding `room:rejoin`. */
  lobbyRefused(code: string | undefined): boolean;
}

/** Owns the stored handles and every outstanding rejoin; returns one object per socket. */
export function useRejoin(
  socket: Socket | null,
  userId: string,
  roomRef: RefObject<WireRoomState | null>,
  gameStateRef: RefObject<GameState | null>
): Rejoin {
  const handlesRef = useRef<TableHandles>({ roomId: null, waitingCode: null });
  // The room id a `game:rejoin` is in flight for. The round-trip is async, so a
  // failure for an old room can land after the player has moved to another one
  // and would wipe that one out instead.
  const requestedRoomIdRef = useRef<string | null>(null);
  const rejoiningCodeRef = useRef<string | null>(null);
  const retriesRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const hold = useCallback((next: Partial<TableHandles>) => {
    const held = handlesRef.current;
    const changed: Partial<TableHandles> = {};
    if (next.roomId !== undefined && next.roomId !== held.roomId) changed.roomId = next.roomId;
    if (next.waitingCode !== undefined && next.waitingCode !== held.waitingCode) {
      changed.waitingCode = next.waitingCode;
    }
    handlesRef.current = { ...held, ...changed };
    storeTableHandles(changed);
  }, []);

  const answered = useCallback(() => {
    requestedRoomIdRef.current = null;
    rejoiningCodeRef.current = null;
    retriesRef.current = 0;
    clearRetryTimer();
  }, [clearRetryTimer]);

  const attempt = useCallback((): boolean => {
    const currentRoom = roomRef.current;
    const currentGame = gameStateRef.current;
    // A room the server calls `in_progress` is worth rejoining even with no
    // hand on this side: requiring one made the client's own copy of the deal
    // the only route into the table.
    const playing = currentRoom?.status === "in_progress";
    if (currentRoom && ((currentGame && !currentGame.roundOver) || playing)) {
      requestedRoomIdRef.current = currentRoom.roomId;
      void send(socket, "game:rejoin", { roomId: currentRoom.roomId }, { retry: false });
      return true;
    }
    const stored = handlesRef.current;
    if (!currentRoom && stored.roomId) {
      requestedRoomIdRef.current = stored.roomId;
      void send(socket, "game:rejoin", { roomId: stored.roomId }, { retry: false });
      return true;
    }

    // A waiting lobby has no game to rejoin, only a seat — released the moment
    // the old socket dropped. `room:rejoin` takes it back and re-maps the new
    // socket to the room; without it the server answers no later room event.
    if (currentGame) return false;
    const waitingCode = currentRoom
      ? currentRoom.status === "waiting"
        ? currentRoom.code
        : null
      : stored.waitingCode;
    if (waitingCode) {
      rejoiningCodeRef.current = waitingCode;
      void send(socket, "room:rejoin", { code: waitingCode }, { retry: false });
      return true;
    }
    return false;
  }, [socket, roomRef, gameStateRef]);

  const release = useCallback(() => {
    answered();
    hold({ roomId: null, waitingCode: null });
  }, [answered, hold]);

  const answers = useCallback(
    (roomId: string | undefined) => !roomId || roomId === requestedRoomIdRef.current,
    []
  );

  const retry = useCallback(
    (onNothingSent: () => void) => {
      if (retriesRef.current >= MAX_REJOIN_RETRIES) return false;
      retriesRef.current += 1;
      clearRetryTimer();
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (!attempt()) onNothingSent();
      }, REJOIN_RETRY_DELAY_MS);
      return true;
    },
    [attempt, clearRetryTimer]
  );

  const lobbyRefused = useCallback((code: string | undefined) => {
    if (!rejoiningCodeRef.current || !TERMINAL_ROOM_REJOIN_CODES.has(code ?? "")) return false;
    rejoiningCodeRef.current = null;
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    readTableHandles()
      .then((stored) => {
        if (cancelled || (!stored.roomId && !stored.waitingCode)) return;
        handlesRef.current = stored;
        if (socket?.connected) attempt();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [socket, userId, attempt]);

  // The retry timer emits; it must not outlive the socket it was set for.
  useEffect(() => clearRetryTimer, [socket, clearRetryTimer]);

  return useMemo(
    () => ({ attempt, answered, hold, release, answers, retry, lobbyRefused }),
    [attempt, answered, hold, release, answers, retry, lobbyRefused]
  );
}
