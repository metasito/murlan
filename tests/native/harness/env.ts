import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from '@testing-library/react-native';
import type { MotionPreference } from '@/lib/accessibility';
import { SETTINGS_KEY } from '@/lib/storageKeys';
import { netInfoListeners } from '../mocks/netInfo';

// The table is landscape-only, so the default window is the e2e phone's, on its side; a test
// that needs portrait asks for it.
const LANDSCAPE_PHONE = { width: 844, height: 390, scale: 2, fontScale: 2 };

type Window = { width: number; height: number; scale?: number; fontScale?: number };

// By path: a file that mocks 'react-native' whole still gets the real Dimensions.
function dimensions(): typeof import('react-native').Dimensions {
  return require('react-native/Libraries/Utilities/Dimensions').default;
}

// Required per call: a file that resets its module registry renders against a fresh copy.
function accessibility(): typeof import('@/lib/accessibility') {
  return require('@/lib/accessibility');
}

// Storage is touched only after setStoredMotion wrote it: files that mock AsyncStorage whole count its reads, or have no setItem.
let storedMotion = false;
// A fresh registry is a launch: pushing a motion there would beat lib/accessibility's stored-settings preload.
let launched = false;

/** Run by setup.ts before every test, while nothing is mounted. */
export async function resetEnv(): Promise<void> {
  dimensions().set({ window: LANDSCAPE_PHONE, screen: LANDSCAPE_PHONE });
  if (launched) accessibility().setMotionPreference('system');
  launched = true;
  netInfoListeners().clear();
  if (!storedMotion) return;
  storedMotion = false;
  const { motion: _, ...rest } = JSON.parse((await AsyncStorage.getItem(SETTINGS_KEY)) ?? '{}');
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
}

/** The window every `useWindowDimensions` reads; `scale` and `fontScale` default to the landscape phone's. */
export async function setWindow(w: Window): Promise<void> {
  const next = { ...LANDSCAPE_PHONE, ...w };
  await act(async () => dimensions().set({ window: next, screen: next }));
}

/** The player's motion choice, as SettingsProvider pushes it: a mounted SettingsProvider pushes its stored one over it. */
export async function setMotion(preference: MotionPreference): Promise<void> {
  await act(async () => accessibility().setMotionPreference(preference));
}

/** `setMotion`, also stored for a SettingsProvider mounted after it to read back. */
export async function setStoredMotion(preference: MotionPreference): Promise<void> {
  storedMotion = true;
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ motion: preference }));
  await setMotion(preference);
}

/** What NetInfo reports to every listener subscribed now. */
export async function setConnectivity(isConnected: boolean | null): Promise<void> {
  await act(async () => netInfoListeners().forEach((l) => l({ isConnected })));
}
