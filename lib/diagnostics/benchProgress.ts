import AsyncStorage from "@react-native-async-storage/async-storage";
import { BENCH_PROGRESS_KEY } from "@/lib/storageKeys";

/** A scenario that was started this many times without finishing is recorded as failed, so a deterministic crash cannot loop. */
export const MAX_STARTS = 3;
const STALE_MS = 3 * 3600_000;

export interface BenchProgress {
  /** The install and the scenario list: a reinstall or another list starts fresh. */
  key: string;
  done: string[];
  starts: Record<string, number>;
  results: Record<string, string>;
  finished: boolean;
  /** Last save: a run older than STALE_MS is not resumed, so a rerun on the same install starts fresh. */
  at: number;
}

export const freshProgress = (key: string): BenchProgress => ({ key, done: [], starts: {}, results: {}, finished: false, at: Date.now() });

export async function loadProgress(key: string): Promise<BenchProgress> {
  try {
    const p = JSON.parse((await AsyncStorage.getItem(BENCH_PROGRESS_KEY)) ?? "null") as BenchProgress | null;
    return p && p.key === key && Array.isArray(p.done) && p.starts && p.results && Date.now() - p.at < STALE_MS ? p : freshProgress(key);
  } catch {
    return freshProgress(key);
  }
}

export async function saveProgress(p: BenchProgress): Promise<void> {
  await AsyncStorage.setItem(BENCH_PROGRESS_KEY, JSON.stringify({ ...p, at: Date.now() })).catch(() => {});
}
