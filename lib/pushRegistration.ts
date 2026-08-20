// Registering this device for notifications, and forgetting it again.
//
// The only notification the app sends is a friend's game invite that arrived
// while the player was not connected (server/push.ts). Permission is therefore
// asked on the Friends screen rather than at launch: iOS asks once and
// remembers the answer forever, and a launch-time prompt for a game the player
// has not yet decided to play with anyone is the one most reliably denied.
import { Platform } from "react-native";
import Constants from "expo-constants";
import { apiRequest } from "./query-client";
import { getLocale } from "./i18n";

/** The device's Expo push token, once obtained, so logout can withdraw it. */
let currentToken: string | null = null;
/** What the server was last told this device reads, so a language change re-registers. */
let registeredLocale: string | null = null;

/** Web has no push here — the game is played in a tab that is already open. */
const supported = () => Platform.OS === "ios" || Platform.OS === "android";

/**
 * Loaded on demand, and only on a platform that can use it.
 *
 * expo-notifications registers a push-token listener as it initialises and
 * warns that the listener does nothing on web. Importing it at module scope
 * put that warning in every web session — the platform the game is actually
 * played on today — for a module web never calls.
 */
async function notifications() {
  return import("expo-notifications");
}

/**
 * The EAS project this build belongs to. `getExpoPushTokenAsync` needs it, and
 * a bare Expo Go run has no such id — in which case there is no token to get
 * and nothing to register.
 */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * Asks for permission if it has not been asked before, and registers the
 * resulting token with the server.
 *
 * Returns quietly on every path that cannot produce a token — web, a build
 * with no EAS project, a denied prompt — because none of them is an error the
 * player should be told about. Safe to call on every visit to the screen:
 * permission is only requested when the OS says it has not been decided, and
 * re-registering an unchanged token is one idempotent upsert.
 */
export async function registerForPush(): Promise<void> {
  if (!supported()) return;

  const id = projectId();
  if (!id) return;

  try {
    const Notifications = await notifications();
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;

    // canAskAgain is false once the player has said no. Asking anyway is a
    // no-op on iOS and a second dialog nobody wants on Android.
    if (!granted && existing.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    const locale = getLocale();
    if (!token || (token === currentToken && locale === registeredLocale)) return;

    await apiRequest("POST", "/api/push/token", {
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
      locale,
    });
    currentToken = token;
    registeredLocale = locale;
  } catch {
    // A device that cannot register simply does not get notifications.
  }
}

/**
 * Withdraws this device on logout.
 *
 * The cascade on `users` only covers an account being deleted. Without this,
 * the next person to sign in on a shared phone would receive the previous
 * player's invites.
 */
export async function unregisterForPush(): Promise<void> {
  const token = currentToken;
  if (!token) return;
  currentToken = null;
  registeredLocale = null;
  try {
    await apiRequest("DELETE", "/api/push/token", {
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
    });
  } catch {
    // The row outlives the session at worst; the next login overwrites it.
  }
}
