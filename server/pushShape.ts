// The pure half of server/push.ts: what goes to Expo, and what comes back.
//
// Split out for the same reason server/replayShape.ts is — this half has no
// database and no network, so `node --test` can load it directly and the
// request shape is checked without a live Postgres.
import { DEFAULT_LOCALE, isLocale, translate, type TranslationKey, type TranslationParams } from "../shared/i18n.ts";

/** A device to deliver to, and the language it reads. */
export interface PushDevice {
  token: string;
  locale: string;
}

export interface PushMessage {
  title: string;
  /**
   * The `code` half of the `{ code, message }` contract in lib/i18n.ts, looked
   * up as `server.<code>`. Rendered here rather than sent as a code, because
   * the OS draws a notification with no client in the loop to translate it.
   */
  code: string;
  params?: TranslationParams;
  /** Delivered to the app as `notification.request.content.data`. */
  data?: Record<string, string>;
}

/** A message's body in one device's language, falling back to English. */
export function renderBody(message: PushMessage, locale: string): string {
  const key = `server.${message.code}` as TranslationKey;
  return translate(isLocale(locale) ? locale : DEFAULT_LOCALE, key, message.params);
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

/** One message per device, each in that device's language. Expo accepts the array in a single POST. */
export function buildPushRequest(
  devices: PushDevice[],
  message: PushMessage
): ExpoPushRequest[] {
  return devices.map(({ token, locale }) => ({
    to: token,
    title: message.title,
    body: renderBody(message, locale),
    data: { ...message.data, code: message.code },
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
