// Every AsyncStorage key the app owns. On web, AsyncStorage is localStorage
// with the key unprefixed, so the browser suite imports these too.

export const AUTH_USER_KEY = "murlan_user";
export const LOCALE_KEY = "murlan.locale";
export const SETTINGS_KEY = "@murlan_settings";
export const ACTIVE_ROOM_KEY = "@murlan_active_room";
export const WAITING_ROOM_KEY = "@murlan_waiting_room";
export const OFFLINE_SAVE_KEY = "@murlan_offline_game";
export const TUTORIAL_SEEN_KEY = "@murlan_tutorial_seen";
export const TUTORIAL_PROGRESS_KEY = "@murlan_tutorial_progress";
export const PENDING_CRASH_REPORTS_KEY = "@murlan_pending_crash_reports";
export const E2E_SUSPEND_AI_KEY = "@murlan_e2e_suspend_ai";

/** The signed-in account's keys: logout removes every one (tests/engine/storageKeys). */
export const ACCOUNT_KEYS = [AUTH_USER_KEY, ACTIVE_ROOM_KEY, WAITING_ROOM_KEY];

/** Keys that belong to the device and outlive any account on it. */
export const DEVICE_KEYS = [
  LOCALE_KEY,
  SETTINGS_KEY,
  OFFLINE_SAVE_KEY,
  TUTORIAL_SEEN_KEY,
  TUTORIAL_PROGRESS_KEY,
  PENDING_CRASH_REPORTS_KEY,
  E2E_SUSPEND_AI_KEY,
];
