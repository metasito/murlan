import React, { createContext, useCallback, useContext, useEffect, useState, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setSoundsMasterEnabled, setSoundsMasterVolume } from "@/lib/sounds";
import { setHapticsMasterEnabled } from "@/lib/haptics";
import { setMotionPreference, type MotionPreference } from "@/lib/accessibility";
import {
  DEFAULT_CARD_BACK,
  DEFAULT_TABLE_FELT,
  isCardBackId,
  isTableFeltId,
  setCosmetics,
  type CardBackId,
  type TableFeltId,
} from "@/lib/cosmetics";

interface Settings {
  soundsEnabled: boolean;
  /** 0–1, multiplied into every effect's own level. */
  soundVolume: number;
  hapticsEnabled: boolean;
  motion: MotionPreference;
  cardBack: CardBackId;
  tableFelt: TableFeltId;
}

interface SettingsContextValue extends Settings {
  setSoundsEnabled: (v: boolean) => void;
  setSoundVolume: (v: number) => void;
  setHapticsEnabled: (v: boolean) => void;
  setMotion: (v: MotionPreference) => void;
  setCardBack: (v: CardBackId) => void;
  setTableFelt: (v: TableFeltId) => void;
}

const STORAGE_KEY = "@murlan_settings";
const defaults: Settings = {
  soundsEnabled: true,
  soundVolume: 1,
  hapticsEnabled: true,
  motion: "system",
  cardBack: DEFAULT_CARD_BACK,
  tableFelt: DEFAULT_TABLE_FELT,
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * A stored value written by an older build can be any shape at all, and a bad
 * one here is silent: a string volume mutes the game, an unknown motion value
 * freezes every animation. Each field is validated rather than spread in.
 */
function parseStored(raw: string): Partial<Settings> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return {};
  const v = parsed as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (typeof v.soundsEnabled === "boolean") out.soundsEnabled = v.soundsEnabled;
  if (typeof v.hapticsEnabled === "boolean") out.hapticsEnabled = v.hapticsEnabled;
  if (typeof v.soundVolume === "number" && Number.isFinite(v.soundVolume)) {
    out.soundVolume = Math.max(0, Math.min(1, v.soundVolume));
  }
  if (v.motion === "system" || v.motion === "on" || v.motion === "off") {
    out.motion = v.motion;
  }
  if (isCardBackId(v.cardBack)) out.cardBack = v.cardBack;
  if (isTableFeltId(v.tableFelt)) out.tableFelt = v.tableFelt;
  return out;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) return;
      try {
        setSettings({ ...defaults, ...parseStored(raw) });
      } catch {}
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => {});
  }, [settings]);

  useEffect(() => {
    setSoundsMasterEnabled(settings.soundsEnabled);
  }, [settings.soundsEnabled]);

  useEffect(() => {
    setSoundsMasterVolume(settings.soundVolume);
  }, [settings.soundVolume]);

  useEffect(() => {
    setHapticsMasterEnabled(settings.hapticsEnabled);
  }, [settings.hapticsEnabled]);

  useEffect(() => {
    setMotionPreference(settings.motion);
  }, [settings.motion]);

  useEffect(() => {
    setCosmetics(settings.cardBack, settings.tableFelt);
  }, [settings.cardBack, settings.tableFelt]);

  const setSoundsEnabled = useCallback((v: boolean) =>
    setSettings((s) => ({ ...s, soundsEnabled: v })), []);
  const setSoundVolume = useCallback((v: number) =>
    setSettings((s) => ({ ...s, soundVolume: Math.max(0, Math.min(1, v)) })), []);
  const setHapticsEnabled = useCallback((v: boolean) =>
    setSettings((s) => ({ ...s, hapticsEnabled: v })), []);
  const setMotion = useCallback((v: MotionPreference) =>
    setSettings((s) => ({ ...s, motion: v })), []);
  const setCardBack = useCallback((v: CardBackId) =>
    setSettings((s) => ({ ...s, cardBack: v })), []);
  const setTableFelt = useCallback((v: TableFeltId) =>
    setSettings((s) => ({ ...s, tableFelt: v })), []);

  const contextValue = useMemo(
    () => ({
      ...settings,
      setSoundsEnabled,
      setSoundVolume,
      setHapticsEnabled,
      setMotion,
      setCardBack,
      setTableFelt,
    }),
    [
      settings,
      setSoundsEnabled,
      setSoundVolume,
      setHapticsEnabled,
      setMotion,
      setCardBack,
      setTableFelt,
    ]
  );

  return (
    <SettingsContext.Provider value={contextValue}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
