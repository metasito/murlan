// The player's card back and table felt.
//
// Deliberately a *local* preference, stored with sound and language in
// SettingsContext rather than in a `user_cosmetics` table. Nothing here is
// visible to anyone else — every card back on a table is drawn the same way
// for the player looking at it — so there is no server state to be
// authoritative about. If cosmetics ever become unlockable, the entitlement is
// what needs a table; the choice still would not.
//
// No react-native import, so tests load it directly.
import { useSyncExternalStore } from "react";
import { CardBacks, FeltGradients } from "./tokens.ts";
import type { TranslationKey } from "./i18n.ts";

export type CardBackId = keyof typeof CardBacks;
export type TableFeltId = keyof typeof FeltGradients;

/** Picker order. The default is first in each. */
export const CARD_BACK_IDS = Object.keys(CardBacks) as CardBackId[];
export const TABLE_FELT_IDS = Object.keys(FeltGradients) as TableFeltId[];

export const DEFAULT_CARD_BACK: CardBackId = "oro";
export const DEFAULT_TABLE_FELT: TableFeltId = "verde";

export function isCardBackId(value: unknown): value is CardBackId {
  return typeof value === "string" && value in CardBacks;
}

export function isTableFeltId(value: unknown): value is TableFeltId {
  return typeof value === "string" && value in FeltGradients;
}

/** Always resolves: an unknown or absent id falls back to the default. */
export function getCardBack(id: string | undefined) {
  return CardBacks[isCardBackId(id) ? id : DEFAULT_CARD_BACK];
}

/** Five gradient stops, light centre to dark rim — a felt's or a card back's own field. */
export type FeltStops = readonly [string, string, string, string, string];

/** Always resolves: an unknown or absent id falls back to the default. */
export function getTableFelt(id: string | undefined): FeltStops {
  return FeltGradients[isTableFeltId(id) ? id : DEFAULT_TABLE_FELT];
}

/** The field a card back is printed on — its own gradient, not the table's. */
export function cardBackField(id: string | undefined): FeltStops {
  return getCardBack(id).field;
}

export function cardBackNameKey(id: CardBackId): TranslationKey {
  return `cosmetics.back.${id}` as TranslationKey;
}

export function tableFeltNameKey(id: TableFeltId): TranslationKey {
  return `cosmetics.felt.${id}` as TranslationKey;
}

// ─── The live choice ──────────────────────────────────────────────────────────
//
// Module-level rather than a React context, for the same reason
// setMotionPreference is: SettingsProvider pushes the value in, and CardView —
// which renders up to fifty-four times on a table — reads it without importing
// the context, which would drag expo-audio into every consumer of a card.

let currentCardBack: CardBackId = DEFAULT_CARD_BACK;
let currentTableFelt: TableFeltId = DEFAULT_TABLE_FELT;
const listeners = new Set<() => void>();

export function setCosmetics(cardBack: CardBackId, tableFelt: TableFeltId): void {
  if (cardBack === currentCardBack && tableFelt === currentTableFelt) return;
  currentCardBack = cardBack;
  currentTableFelt = tableFelt;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const readCardBack = () => currentCardBack;
const readTableFelt = () => currentTableFelt;

/** The card back the player chose. */
export function useCardBack() {
  return getCardBack(useSyncExternalStore(subscribe, readCardBack, readCardBack));
}

/** The felt the player chose, as its five gradient stops. */
export function useTableFelt(): FeltStops {
  return getTableFelt(useSyncExternalStore(subscribe, readTableFelt, readTableFelt));
}
