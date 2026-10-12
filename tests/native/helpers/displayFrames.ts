const FRAME_MS = 1000 / 60;

/**
 * Worklets' jest rAF is a 0 ms setTimeout, which fake timers fire every 1 ms: a thousand frames of
 * every running animation per second settled. Paces it at a display's 60 Hz until the returned restore.
 */
export function displayFrames(): () => void {
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), FRAME_MS) as unknown as number;
  return () => {
    globalThis.requestAnimationFrame = raf;
  };
}
