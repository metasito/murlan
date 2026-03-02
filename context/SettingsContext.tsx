import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setSoundsMasterEnabled } from "@/lib/sounds";
import { setHapticsMasterEnabled } from "@/lib/haptics";

interface Settings {
  soundsEnabled: boolean;
  hapticsEnabled: boolean;
}

interface SettingsContextValue extends Settings {
  setSoundsEnabled: (v: boolean) => void;
  setHapticsEnabled: (v: boolean) => void;
}

const STORAGE_KEY = "@murlan_settings";
const defaults: Settings = { soundsEnabled: true, hapticsEnabled: true };

const SettingsContext = createContext<SettingsContextValue>({
  ...defaults,
  setSoundsEnabled: () => {},
  setHapticsEnabled: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          setSettings({ ...defaults, ...JSON.parse(raw) });
        } catch {}
      }
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => {});
  }, [settings]);

  useEffect(() => {
    setSoundsMasterEnabled(settings.soundsEnabled);
  }, [settings.soundsEnabled]);

  useEffect(() => {
    setHapticsMasterEnabled(settings.hapticsEnabled);
  }, [settings.hapticsEnabled]);

  const setSoundsEnabled = (v: boolean) =>
    setSettings((s) => ({ ...s, soundsEnabled: v }));
  const setHapticsEnabled = (v: boolean) =>
    setSettings((s) => ({ ...s, hapticsEnabled: v }));

  return (
    <SettingsContext.Provider
      value={{ ...settings, setSoundsEnabled, setHapticsEnabled }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
