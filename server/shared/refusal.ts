import type { ServerPayload } from "../../shared/protocol.ts";
import type { TranslationParams } from "../../shared/i18n.ts";
import { payload, type ServerCode } from "./payload.ts";

/** What a handler, lobby intent or table action answers. Never `void`. */
export type Outcome = { ok: true; code?: never } | Refusal;

export interface Refusal {
  ok: false;
  code: string;
  /** The words the asking socket is shown; absent means a silent refusal (ack only). */
  notice?: ServerPayload;
}

export const OK: Outcome = { ok: true };

/** A refusal the player is told about, in the same code the ack carries. */
export function refuse<C extends ServerCode>(code: C, params?: TranslationParams): Refusal {
  return { ok: false, code, notice: payload(code, params) };
}
