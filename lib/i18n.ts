// Typed localisation layer.
//
// - `it` (Italian) is authoritative; `TranslationKey` is derived from it, so
//   a typo'd or missing key in any locale — or at any `t()` call site — is a
//   compile error, not a blank label at runtime (locales/en.ts, locales/sq.ts
//   are each typed `Record<TranslationKey, string>`).
// - Detects the device locale via expo-localization, falls back to Italian,
//   and persists an explicit override to AsyncStorage.
// - `useTranslation()` subscribes to locale changes (useSyncExternalStore),
//   so every screen calling it re-renders immediately when the player
//   changes language in SettingsModal — no app restart required.
// - `translateServerPayload` renders the `{ code, message, params }` shape
//   emitted by server/socket.ts and server/routes.ts (see docs there): the
//   server never ships its own translation table, only a stable code plus an
//   English fallback for safety.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useSyncExternalStore } from "react";
// Relative (not `@/`) on purpose: node's native TS loader, used by
// `node --test` for tests/i18n.test.ts, does not resolve tsconfig `paths`
// aliases, only relative specifiers with an explicit extension (see
// tsconfig.json's `allowImportingTsExtensions` and tests/helpers.ts for the
// same convention). Metro/Expo resolves either form fine at app runtime.
import { it } from "../locales/it.ts";
import { en } from "../locales/en.ts";
import { sq } from "../locales/sq.ts";

export type TranslationKey = keyof typeof it;
export type Locale = "it" | "en" | "sq";
export type TranslationParams = Record<string, string | number>;

export const SUPPORTED_LOCALES: Locale[] = ["it", "en", "sq"];
export const DEFAULT_LOCALE: Locale = "it";

export const LOCALE_LABELS: Record<Locale, string> = {
  it: "Italiano",
  en: "English",
  sq: "Shqip",
};

const STORAGE_KEY = "murlan.locale";

const catalogs: Record<Locale, Record<TranslationKey, string>> = { it, en, sq };

function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as string[]).includes(value);
}

let currentLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Best match between the device's preferred languages and our locales. */
export function detectDeviceLocale(): Locale {
  try {
    // Deferred require, not a static import: keeps this module importable
    // under plain Node (tests/i18n.test.ts, via `node --test`) without
    // pulling in expo-localization's native binding, which only resolves
    // inside the Expo/RN runtime — and doubles as the try/catch's coverage
    // for "expo-localization unavailable" on top of the lookup itself.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Localization = require("expo-localization") as typeof import("expo-localization");
    const deviceLocales = Localization.getLocales?.() ?? [];
    for (const entry of deviceLocales) {
      const code = entry.languageCode?.toLowerCase();
      if (isLocale(code)) return code;
    }
  } catch {
    // expo-localization can be unavailable in some test/web environments —
    // fall through to the default rather than throwing at startup.
  }
  return DEFAULT_LOCALE;
}

export function getLocale(): Locale {
  return currentLocale;
}

/** Sets the active locale and persists it as an explicit player override. */
export async function setLocale(locale: Locale): Promise<void> {
  if (locale === currentLocale) return;
  currentLocale = locale;
  notify();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Persistence is best-effort; the in-memory locale still applies this session.
  }
}

let initPromise: Promise<Locale> | null = null;

/**
 * Restores a saved language override, or detects the device locale, falling
 * back to Italian. Call once at app startup (app/_layout.tsx). Safe to call
 * more than once — subsequent calls return the same in-flight/resolved promise.
 */
export function initLocale(): Promise<Locale> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      currentLocale = isLocale(saved) ? saved : detectDeviceLocale();
    } catch {
      currentLocale = detectDeviceLocale();
    }
    notify();
    return currentLocale;
  })();
  return initPromise;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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

/** Translate in the currently active locale. Prefer `useTranslation()` inside components. */
export function t(key: TranslationKey, params?: TranslationParams): string {
  return translate(currentLocale, key, params);
}

/**
 * Simple pluralisation: picks `${base}_one` when `count` is 1, otherwise
 * `${base}_other`. Both suffixed keys must exist in every locale catalogue
 * (enforced by tests/i18n.test.ts) and `count` is always available to the
 * template as `{{count}}`.
 */
export function tn(base: string, count: number, params?: TranslationParams): string {
  const suffix = Math.abs(count) === 1 ? "_one" : "_other";
  const key = `${base}${suffix}` as TranslationKey;
  return t(key, { count, ...params });
}

export interface ServerPayload {
  code?: string;
  message?: string;
  /** A few endpoints (e.g. the rate limiters) use `error` instead of `message`. */
  error?: string;
  params?: TranslationParams;
}

/**
 * Renders a server-emitted `{ code, message, params }` payload in the
 * player's language. `code` is looked up as `server.<code>` in the current
 * catalogue. If the code is unknown to this client build (an older client
 * talking to a newer server, or a code that was never localised) the
 * server's plain-text Italian `message` is shown instead — the plain-text
 * fallback exists precisely so nobody ever sees a blank error.
 */
export function translateServerPayload(payload: ServerPayload): string {
  if (payload.code) {
    const key = `server.${payload.code}` as TranslationKey;
    if (Object.prototype.hasOwnProperty.call(catalogs[DEFAULT_LOCALE], key)) {
      return translate(currentLocale, key, payload.params);
    }
  }
  return payload.message ?? payload.error ?? t("common.unknownError");
}

/** React hook: re-renders the caller whenever the active locale changes. */
export function useTranslation() {
  const locale = useSyncExternalStore(subscribe, getLocale, () => DEFAULT_LOCALE);

  const tBound = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(locale, key, params),
    [locale]
  );
  const tnBound = useCallback(
    (base: string, count: number, params?: TranslationParams) => {
      const suffix = Math.abs(count) === 1 ? "_one" : "_other";
      return tBound(`${base}${suffix}` as TranslationKey, { count, ...params });
    },
    [tBound]
  );
  const translateServerPayloadBound = useCallback(
    (payload: ServerPayload) => {
      if (payload.code) {
        const key = `server.${payload.code}` as TranslationKey;
        if (Object.prototype.hasOwnProperty.call(catalogs[DEFAULT_LOCALE], key)) {
          return translate(locale, key, payload.params);
        }
      }
      return payload.message ?? payload.error ?? tBound("common.unknownError");
    },
    [locale, tBound]
  );

  return {
    t: tBound,
    tn: tnBound,
    translateServerPayload: translateServerPayloadBound,
    locale,
    setLocale,
    locales: SUPPORTED_LOCALES,
    localeLabels: LOCALE_LABELS,
  };
}
