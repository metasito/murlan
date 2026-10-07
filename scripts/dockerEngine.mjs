export function dockerDesktopPaths(env = process.env) {
  return [
    env.LOCALAPPDATA && `${env.LOCALAPPDATA}\\Programs\\DockerDesktop\\Docker Desktop.exe`,
    env.ProgramFiles && `${env.ProgramFiles}\\Docker\\Docker\\Docker Desktop.exe`,
  ].filter(Boolean);
}

/** A `docker info` that timed out or was killed came from an engine too starved to answer, not a stopped one. */
export const dockerInfo = (run) => (timeout) => {
  const r = run("docker", ["info"], { timeout });
  if (r.status === 0) return true;
  return r.error?.code === "ETIMEDOUT" || Boolean(r.signal) ? "slow" : false;
};

/** `engineUp(timeoutMs)` answers true, false (down) or "slow" (no answer in time): only a known-down engine is launched. */
export function ensureEngine({
  engineUp,
  exists,
  launch,
  sleep,
  platform = process.platform,
  paths,
  budgetMs = 3 * 60_000,
  stepMs = 5_000,
  probeMs = 15_000,
  slowProbeMs = 60_000,
}) {
  const start = () => {
    if (platform !== "win32") throw new Error("the docker engine is not running — start it");
    const exe = paths.find(exists);
    if (!exe) throw new Error(`the docker engine is down and Docker Desktop was not found at: ${paths.join(", ")}`);
    launch(exe);
    return exe;
  };
  const first = engineUp(probeMs);
  if (first === true) return "up";
  let exe = first === "slow" ? null : start();
  let waited = first === "slow" ? probeMs : 0;
  while (waited < budgetMs) {
    sleep(stepMs);
    waited += stepMs;
    const up = engineUp(slowProbeMs);
    if (up === true) return exe ? "started" : "up";
    if (up === "slow") waited += slowProbeMs;
    else exe ??= start();
  }
  throw new Error(
    exe
      ? `the docker engine did not come up within ${budgetMs / 1000}s after launching ${exe} — check the Docker Desktop window`
      : `the docker engine is running but did not answer \`docker info\` within ${budgetMs / 1000}s — it is starved; free memory, then run this again`,
  );
}
