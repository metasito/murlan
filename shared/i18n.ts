// The half of the localisation layer with no runtime behind it: the catalogues,
// and rendering one key in one locale.
//
// Split from lib/i18n.ts so the server can reach it. lib/i18n.ts imports
// AsyncStorage and React to hold the *active* locale, neither of which exists
// under Node — and server/push.ts has to translate, because a notification is
// rendered by the OS with no client in the loop to do it.
import { en } from "../locales/en.ts";
import { it } from "../locales/it.ts";
import { sq } from "../locales/sq.ts";

export type TranslationKey = keyof typeof en;
export type Locale = "it" | "en" | "sq";
export type TranslationParams = Record<string, string | number>;

export const SUPPORTED_LOCALES: Locale[] = ["it", "en", "sq"];
export const DEFAULT_LOCALE: Locale = "en";

export const catalogs: Record<Locale, Record<TranslationKey, string>> = { it, en, sq };

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as string[]).includes(value);
}

/** Replaces every `{{name}}` placeholder in `template` with `params[name]`. */
export function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

export function translate(locale: Locale, key: TranslationKey, params?: TranslationParams): string {
  const template = catalogs[locale][key] ?? catalogs[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, params);
}
