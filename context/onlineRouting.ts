export type OnlineRoute = "lobby" | "quickmatch" | "room" | "game" | "other";
export type EntrySource = "quickmatch" | "friends" | null;
export type OnlineFacts = {
  roomId: string | null;
  hasGame: boolean;
  isSpectator: boolean;
  rejoinFailed: boolean;
};
export type LobbyPath = "/(online)" | "/(online)/quickmatch";
export type OnlinePath = LobbyPath | "/(online)/room" | "/(online)/game";
export type Navigation = { kind: "push" | "replace"; to: OnlinePath } | null;

export const NO_TABLE: OnlineFacts = { roomId: null, hasGame: false, isSpectator: false, rejoinFailed: false };

/** `useSegments()` inside the `(online)` group, as the place the router decides from. */
export function onlineRouteOf(segments: readonly string[]): OnlineRoute {
  if (segments[0] !== "(online)") return "other";
  const leaf = segments[1];
  if (leaf === undefined || leaf === "index") return "lobby";
  if (leaf === "quickmatch" || leaf === "room" || leaf === "game") return leaf;
  return "other";
}

export function lobbyFor(entrySource: EntrySource): LobbyPath {
  return entrySource === "quickmatch" ? "/(online)/quickmatch" : "/(online)";
}

/**
 * Pure. One change of facts, or of where the player is, gives at most one navigation.
 * The room screen is a place only a held, unstarted room may occupy, so it is judged on
 * state; everywhere else moves only on a change, so a table already followed is not
 * followed twice.
 */
export function navigationFor(
  prev: OnlineFacts,
  next: OnlineFacts,
  here: OnlineRoute,
  entrySource: EntrySource
): Navigation {
  const atTable = here === "room" || here === "game";
  const lobby = { kind: "replace", to: lobbyFor(entrySource) } as const;

  if (next.rejoinFailed && !prev.rejoinFailed) return atTable ? lobby : null;

  if (here === "room") {
    if (!next.roomId) return lobby;
    if (next.hasGame) return { kind: "replace", to: "/(online)/game" };
    return null;
  }

  if (here === "game") {
    const held = prev.roomId !== null || prev.hasGame;
    return held && !next.roomId && !next.hasGame ? lobby : null;
  }

  const enter = (to: OnlinePath): Navigation => ({ kind: here === "quickmatch" ? "replace" : "push", to });

  if (next.hasGame && !prev.hasGame && (next.isSpectator || !prev.roomId)) {
    return enter("/(online)/game");
  }
  if (next.roomId && next.roomId !== prev.roomId && !next.hasGame && !next.isSpectator) {
    return enter("/(online)/room");
  }
  return null;
}
