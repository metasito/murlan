export interface HapticsState {
  calls: { type: string; at: number }[];
}

export function turboHapticsState(): HapticsState {
  const g = globalThis as { __turboHaptics?: HapticsState };
  g.__turboHaptics ??= { calls: [] };
  return g.__turboHaptics;
}

export function turboHapticsModule() {
  const s = turboHapticsState();
  return {
    __esModule: true,
    triggerHaptics: (type: string) => {
      s.calls.push({ type, at: performance.now() });
    },
    __mock: s,
  };
}
