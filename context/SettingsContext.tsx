import React, { createContext, useCallback, useContext, useEffect, useState, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setSoundsMasterVolume } from "@/lib/sounds";
import { setMusicMasterEnabled, setMusicMasterVolume } from "@/lib/music";
import { setHapticsMasterEnabled } from "@/lib/haptics";
import { setMotionPreference, type MotionPreference } from "@/lib/accessibility";
import { migrateAudio, withEnabled, withVolume, type AudioLevel } from "@/lib/audioLevel";
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
  /** 0–1, multiplied into every effect's own level. 0 is muted. */
  soundVolume: number;
  /** What unmuting the effects returns to. */
  soundVolumeRestore: number;
  /** 0–1. Defaults below the effects so the bed never competes with them. */
  musicVolume: number;
  /** What unmuting the music returns to. */
  musicVolumeRestore: number;
  hapticsEnabled: boolean;
  motion: MotionPreference;
  cardBack: CardBackId;
  tableFelt: TableFeltId;
}

/**
 * `soundsEnabled` and `musicEnabled` are derived from their volumes rather than
 * stored, so nothing can say "on" while the level says silence. They stay in
 * the API because both settings surfaces still present a switch (#415, #416).
 */
interface SettingsContextValue extends Settings {
  soundsEnabled: boolean;
  musicEnabled: boolean;
  setSoundsEnabled: (v: boolean) => void;
  setSoundVolume: (v: number) => void;
  setMusicEnabled: (v: boolean) => void;
  setMusicVolume: (v: number) => void;
  setHapticsEnabled: (v: boolean) => void;
  setMotion: (v: MotionPreference) => void;
  setCardBack: (v: CardBackId) => void;
  setTableFelt: (v: TableFeltId) => void;
}

const STORAGE_KEY = "@murlan_settings";
const DEFAULT_SOUND_VOLUME = 1;
const DEFAULT_MUSIC_VOLUME = 0.5;

const defaults: Settings = {
  soundVolume: DEFAULT_SOUND_VOLUME,
  soundVolumeRestore: DEFAULT_SOUND_VOLUME,
  musicVolume: DEFAULT_MUSIC_VOLUME,
  musicVolumeRestore: DEFAULT_MUSIC_VOLUME,
  hapticsEnabled: true,
  motion: "system",
  cardBack: DEFAULT_CARD_BACK,
  tableFelt: DEFAULT_TABLE_FELT,
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const soundLevel = (s: Settings): AudioLevel => ({
  volume: s.soundVolume,
  restore: s.soundVolumeRestore,
});
const musicLevel = (s: Settings): AudioLevel => ({
  volume: s.musicVolume,
  restore: s.musicVolumeRestore,
});
const withSound = (s: Settings, l: AudioLevel): Settings => ({
  ...s,
  soundVolume: l.volume,
  soundVolumeRestore: l.restore,
});
const withMusic = (s: Settings, l: AudioLevel): Settings => ({
  ...s,
  musicVolume: l.volume,
  musicVolumeRestore: l.restore,
});

/**
 * A stored value written by an older build can be any shape at all, and a bad
 * one here is silent: a string volume mutes the game, an unknown motion value
 * freezes every animation. Each field is validated rather than spread in.
 */
function parseStored(raw: string): Partial<Settings> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return {};
  const v = parsed as Record<string, unknown>;
  const out: Partial<Settings> = migrateAudio(v, DEFAULT_SOUND_VOLUME, DEFAULT_MUSIC_VOLUME);
  if (typeof v.hapticsEnabled === "boolean") out.hapticsEnabled = v.hapticsEnabled;
  if (v.motion === "system" || v.motion === "on" || v.motion === "off") {
    out.motion = v.motion;
  }
  if (isCardBackId(v.cardBack)) out.cardBack = v.cardBack;
  if (isTableFeltId(v.tableFelt)) out.tableFelt = v.tableFelt;
  return out;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [readFinished, setReadFinished] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          setSettings({ ...defaults, ...parseStored(raw) });
        } catch {}
      })
      // Not in `then`: a rejected read must release the write below too, or one
      // failed read stops settings persisting for the session.
      .finally(() => setReadFinished(true))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!readFinished) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => {});
  }, [settings, readFinished]);

  useEffect(() => {
    setSoundsMasterVolume(settings.soundVolume);
  }, [settings.soundVolume]);

  // Both, from one value in one pass: `setMusicMasterEnabled(false)` stops the
  // track, where a volume of 0 only silences it — driven apart they would leave
  // the bed playing inaudibly.
  useEffect(() => {
    setMusicMasterEnabled(settings.musicVolume > 0);
    setMusicMasterVolume(settings.musicVolume);
  }, [settings.musicVolume]);

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
    setSettings((s) => withSound(s, withEnabled(soundLevel(s), v, DEFAULT_SOUND_VOLUME))), []);
  const setSoundVolume = useCallback((v: number) =>
    setSettings((s) => withSound(s, withVolume(soundLevel(s), v))), []);
  const setMusicEnabled = useCallback((v: boolean) =>
    setSettings((s) => withMusic(s, withEnabled(musicLevel(s), v, DEFAULT_MUSIC_VOLUME))), []);
  const setMusicVolume = useCallback((v: number) =>
    setSettings((s) => withMusic(s, withVolume(musicLevel(s), v))), []);
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
      soundsEnabled: settings.soundVolume > 0,
      musicEnabled: settings.musicVolume > 0,
      setSoundsEnabled,
      setSoundVolume,
      setMusicEnabled,
      setMusicVolume,
      setHapticsEnabled,
      setMotion,
      setCardBack,
      setTableFelt,
    }),
    [
      settings,
      setSoundsEnabled,
      setSoundVolume,
      setMusicEnabled,
      setMusicVolume,
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
