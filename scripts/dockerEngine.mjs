export function dockerDesktopPaths(env = process.env) {
  return [
    env.LOCALAPPDATA && `${env.LOCALAPPDATA}\\Programs\\DockerDesktop\\Docker Desktop.exe`,
    env.ProgramFiles && `${env.ProgramFiles}\\Docker\\Docker\\Docker Desktop.exe`,
  ].filter(Boolean);
}

export function ensureEngine({ engineUp, exists, launch, sleep, platform = process.platform, paths, budgetMs = 3 * 60_000, stepMs = 5_000 }) {
  if (engineUp()) return "up";
  if (platform !== "win32") throw new Error("the docker engine is not running — start it");
  const exe = paths.find(exists);
  if (!exe) throw new Error(`the docker engine is down and Docker Desktop was not found at: ${paths.join(", ")}`);
  launch(exe);
  for (let waited = 0; waited < budgetMs; waited += stepMs) {
    sleep(stepMs);
    if (engineUp()) return "started";
  }
  throw new Error(`the docker engine did not come up within ${budgetMs / 1000}s after launching ${exe} — check the Docker Desktop window`);
}
