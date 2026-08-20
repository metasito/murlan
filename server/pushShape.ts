// The pure half of server/push.ts: what goes to Expo, and what comes back.
//
// Split out for the same reason server/replayShape.ts is — this half has no
// database and no network, so `node --test` can load it directly and the
// request shape is checked without a live Postgres.

export interface PushMessage {
  title: string;
  /**
   * English, and the fallback half of the `{ code, message }` contract in
   * lib/i18n.ts: the OS renders this text with no client in the loop, so a
   * translated `body` would be one language for everybody.
   */
  body: string;
  code?: string;
  /** Delivered to the app as `notification.request.content.data`. */
  data?: Record<string, string>;
}

/** One entry of Expo's `/push/send` request array. */
export interface ExpoPushRequest {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound: "default";
}

/** A ticket from Expo's response, in the same order the messages were sent. */
export interface ExpoTicket {
  status?: string;
  details?: { error?: string };
}

/** The error Expo returns for a token whose app is no longer installed. */
export const DEVICE_NOT_REGISTERED = "DeviceNotRegistered";

/** One message per device. Expo accepts the array in a single POST. */
export function buildPushRequest(
  tokens: string[],
  message: PushMessage
): ExpoPushRequest[] {
  return tokens.map((to) => ({
    to,
    title: message.title,
    body: message.body,
    data: message.code ? { ...message.data, code: message.code } : message.data,
    sound: "default",
  }));
}

/**
 * The tokens Expo says no longer exist, from a response read positionally.
 *
 * Deleting these is the only receipt handling worth having: without it a
 * reinstalled app leaves a dead row behind forever. A short or malformed
 * response yields nothing rather than mis-pairing a ticket with the wrong
 * token — deleting a live device's registration because the response was
 * truncated is far worse than keeping a dead one.
 */
export function deadTokens(tokens: string[], tickets: ExpoTicket[] | undefined): string[] {
  if (!Array.isArray(tickets) || tickets.length !== tokens.length) return [];
  return tokens.filter((_, i) => tickets[i]?.details?.error === DEVICE_NOT_REGISTERED);
}
