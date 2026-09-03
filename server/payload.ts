// The one place a server-emitted `{ code, message, params }` payload is
// built. `code` is a `server.*` locale key with the `server.` prefix
// stripped, so a code with no matching locale entry is a compile error
// rather than an English literal quietly drifting from `locales/en.ts`
// (`lib/i18n.ts`'s `translateServerPayload` is what a client resolves
// `code` back through, in its own language).
import { DEFAULT_LOCALE, translate } from "../shared/i18n.ts";
import type { TranslationKey, TranslationParams } from "../shared/i18n.ts";

type ExtractServerCode<K> = K extends `server.${infer C}` ? C : never;
type ServerCode = ExtractServerCode<TranslationKey>;

export function payload<C extends ServerCode>(code: C, params: TranslationParams = {}) {
  return { code, message: translate(DEFAULT_LOCALE, `server.${code}`, params), params };
}
