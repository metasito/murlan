import AsyncStorage from "@react-native-async-storage/async-storage";
import { SETTINGS_KEY } from "@/lib/storageKeys";

/**
 * The stored settings object, unvalidated: each field's owner checks its own. Null when nothing
 * usable is stored or the read fails, so a caller has one outcome to handle, never a rejection.
 */
export async function readStoredSettings(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
