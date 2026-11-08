// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { TFn } from "@/lib/i18n";
import type { LinkPill } from "../../lib/ownLink.ts";
import type { ServerPayload } from "../../shared/protocol.ts";

/**
 * The connection as the turn pill carries it (Q8): the lantern mockup's `renderTurn` with `S.net` set.
 * `reconnected` is another seat back; `back` and `lost` are the viewer's own.
 */
export type ConnectionNote = {
  state: "offline" | "reconnecting" | "reconnected" | "back" | "lost";
  text: string;
  action?: { label: string; onPress: () => void };
};

/** The codes a `reconnected` note translates: what `game:player_reconnected` carries (server/socket/socketTable.ts). */
export const RECONNECT_CODES = ["PLAYER_RECONNECTED"] as const;

/** The viewer's own link outranks another player's return: a table that has stopped updating otherwise reads as an opponent taking their time. */
export function linkNote(
  pill: LinkPill | null,
  reconnect: ServerPayload | null,
  say: { t: TFn; translateServerPayload: (payload: ServerPayload) => string; retry: () => void }
): ConnectionNote | null {
  const { t } = say;
  if (pill === "lost") return { state: "lost", text: t("onlineGame.connectionLost"), action: { label: t("common.retry"), onPress: say.retry } };
  if (pill === "back") return { state: "back", text: t("onlineGame.backOnline") };
  if (pill === "reconnecting") return { state: "reconnecting", text: t("onlineGame.reconnecting") };
  if (pill === "reconnected" && reconnect) return { state: "reconnected", text: say.translateServerPayload(reconnect) };
  return null;
}

/** The device being offline outranks whatever the screen says of the link; a table with no link to speak of carries none. */
export function tableConnection(link: ConnectionNote | null | undefined, deviceOffline: boolean, t: TFn): ConnectionNote | null {
  if (link === undefined) return null;
  return deviceOffline ? { state: "offline", text: t("offlineBanner.text") } : link;
}
