// server/tableActions.ts — everything one instance may ask another to do to a
// live table.
//
// Types only, deliberately: the router needs the shape and the handlers need
// the shape, and a module with no runtime imports cannot be half of a cycle.
//
// A closed union rather than forwarding the raw socket event with a stand-in
// socket. The handler bodies call `socket.emit`, `socket.join` and
// `socketRoomMap`, none of which mean anything on another instance, and a shim
// that pretends they do fails silently. Naming the actions makes what crosses
// an instance boundary something a reader can enumerate.
import type { MatchLength } from "../lib/gameEngine.ts";
import type { BotPersonalityId } from "../lib/botPersonalities.ts";

/** Every action names the room it is about; that is how the owner is found. */
export interface TableActionBase {
  /**
   * Stamped by the router, unique per attempt-set. A forward whose answer did
   * not come back in time is sent again, and the owner has to be able to tell
   * that from a second `game:pass` — replaying one would take a turn twice.
   */
  id: string;
  roomId: string;
  userId: string;
  username: string;
}

export type TableAction =
  | (TableActionBase & { kind: "play"; cardIds: string[] })
  | (TableActionBase & { kind: "pass" })
  | (TableActionBase & { kind: "exchange"; cardId: string })
  | (TableActionBase & { kind: "reaction"; emoji: string })
  | (TableActionBase & { kind: "rematchIntent"; wants: boolean })
  | (TableActionBase & { kind: "rematchVote" })
  /** A vote to end the match outright, once a seat has been vacated. */
  | (TableActionBase & { kind: "endMatchVote" })
  /**
   * The half of `game:rejoin` that needs the game. The socket's own half —
   * `socket.join`, `socketRoomMap` — stays where the socket is.
   */
  | (TableActionBase & { kind: "rejoin" })
  | (TableActionBase & { kind: "spectate" })
  | (TableActionBase & { kind: "unspectate" })
  | (TableActionBase & {
      kind: "startMatch";
      fillWithBots?: boolean;
      botPersonality?: BotPersonalityId;
      matchLength?: MatchLength;
    })
  /** A seated player's socket went away on some instance. */
  | (TableActionBase & { kind: "seatLost" })
  /** The seat is given up for good: a leave, an expired grace, a deleted account. */
  | (TableActionBase & { kind: "vacate" });

export type TableActionKind = TableAction["kind"];

/**
 * An action as a call site writes it; the router stamps the `id`.
 *
 * Distributed over the union rather than a plain `Omit`, which collapses a
 * union to the properties every member shares — dropping `cardIds`, `emoji`
 * and the rest without a word.
 */
export type TableActionDraft = TableAction extends infer T
  ? T extends TableAction
    ? Omit<T, "id">
    : never
  : never;

/**
 * What an instance may do with an action for a room no instance holds.
 *
 * `create` — deal a new hand. `startMatch` alone, because it is the only
 * action that brings a table into being.
 *
 * `restore` — take the room over: claim it, put the persisted game back in
 * memory and act on it. This is what makes the owning instance dying a
 * non-event, and it is limited to the actions a player is waiting on, so a
 * finished table is never woken up by a stray message.
 *
 * `forward` — do nothing. Reviving a stranded hand to hand one seat to a bot
 * would set the whole table playing itself with nobody watching.
 */
export function takeoverMode(kind: TableActionKind): "create" | "restore" | "forward" {
  if (kind === "startMatch") return "create";
  return kind === "play" ||
    kind === "pass" ||
    kind === "exchange" ||
    kind === "rematchIntent" ||
    kind === "rematchVote" ||
    kind === "endMatchVote" ||
    kind === "rejoin"
    ? "restore"
    : "forward";
}
