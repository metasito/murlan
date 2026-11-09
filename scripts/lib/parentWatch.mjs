const running = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
};

/**
 * Calls `onGone` once the process that started this one is gone. POSIX re-parents an orphan to pid
 * 1 and Windows leaves `ppid` as it was, so it asks both: the number changed, or nothing answers
 * to it. Without this, a SIGKILLed runner leaves its wrapper and everything the wrapper started.
 */
export function exitWithParent(onGone, { parent = process.ppid, everyMs = 1000, isRunning = running } = {}) {
  const timer = setInterval(() => {
    if (process.ppid === parent && isRunning(parent)) return;
    clearInterval(timer);
    onGone();
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
