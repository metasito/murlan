import AsyncStorage from "@react-native-async-storage/async-storage";
import { TUTORIAL_PROGRESS_KEY } from "../storageKeys.ts";

/** The beat to resume at: the saved one's index, else the first. */
export function resumeIndex(beatIds: readonly string[], savedId: string | null): number {
  return Math.max(0, beatIds.indexOf(savedId ?? ""));
}

export async function loadResumeIndex(beatIds: readonly string[]): Promise<number> {
  return resumeIndex(beatIds, await AsyncStorage.getItem(TUTORIAL_PROGRESS_KEY));
}

export function saveProgress(beatId: string): Promise<void> {
  return AsyncStorage.setItem(TUTORIAL_PROGRESS_KEY, beatId).catch(() => {});
}

/** Deliberately done with this run, so the next one starts from the top. */
export function clearProgress(): Promise<void> {
  return AsyncStorage.removeItem(TUTORIAL_PROGRESS_KEY);
}
