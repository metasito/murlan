import { translateServerPayload, type ServerPayload } from "./i18n";

/**
 * A refused request, with the server's own answer still attached.
 *
 * `message` keeps the `"<status>: <body>"` form because it is what reaches a
 * log or an unhandled rejection, and reading a status off a rendered string is
 * the thing this class exists to stop being necessary — `/\d+: (.+)/` also
 * mis-splits any body containing `": "` after a digit.
 *
 * Here rather than beside the fetch client: a screen that only needs to say
 * what went wrong would otherwise import `expo/fetch` through it.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The parsed JSON body, or `null` when the server sent something else. */
    readonly payload: ServerPayload | null,
    /** …and the raw text, for the cases that are not JSON at all. */
    readonly body: string
  ) {
    super(`${status}: ${body}`);
    this.name = "ApiError";
  }

  /** The server's stable error code, if it sent one. */
  get code(): string | undefined {
    return this.payload?.code;
  }
}

export function parseServerPayload(body: string): ServerPayload | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" ? (parsed as ServerPayload) : null;
  } catch {
    return null;
  }
}

/**
 * What to show a player for a request that failed, in their language.
 *
 * `fallback` is what they see when the failure was not the server answering —
 * a dropped connection, a proxy's HTML error page — so it is per-caller rather
 * than one generic sentence.
 */
export function serverErrorMessage(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  if (e.payload) return translateServerPayload(e.payload);
  return e.body || fallback;
}
