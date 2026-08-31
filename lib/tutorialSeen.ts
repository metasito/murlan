import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "@/lib/query-client";
import type { AuthUser } from "@/context/AuthContext";

const SEEN_KEY = "@murlan_tutorial_seen";

/**
 * Records that the tutorial has been offered, on this device and on the
 * account at once. Two write sites is how the two answers drift apart.
 *
 * A signed-out player has only the device, and that is the right answer for
 * them: the account half exists so that signing in on a second phone does not
 * offer the tutorial to someone who finished it months ago.
 */
export async function markTutorialSeen(userId: string | null): Promise<void> {
  await AsyncStorage.setItem(SEEN_KEY, "1").catch(() => {});
  // Started, never awaited. The device half above is the one the next screen
  // reads back, and `apiRequest` has no timeout — awaiting a round trip here
  // makes leaving this screen depend on the phone having signal, which is a
  // Skip button that silently does nothing.
  if (userId) void apiRequest("POST", "/api/users/me/tutorial-seen").catch(() => {});
}

/** Either source counts: the account outlives the install, the device answers offline. */
export async function tutorialSeen(user: AuthUser | null): Promise<boolean> {
  const onThisDevice = await AsyncStorage.getItem(SEEN_KEY).catch(() => null);
  return onThisDevice !== null || Boolean(user?.tutorialSeenAt);
}
