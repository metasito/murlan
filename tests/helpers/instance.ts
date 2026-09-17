import { spawn, type ChildProcess } from "node:child_process";

export interface Instance {
  port: number;
  child: ChildProcess;
}

/** A real server process on `port`, against `databaseUrl`. */
export function boot(
  port: number,
  databaseUrl: string,
  env: Record<string, string> = {}
): Promise<Instance> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "server/index.ts"],
      {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          PORT: String(port),
          SESSION_SECRET: "cross-instance-secret",
          LOG_LEVEL: "silent",
          NODE_ENV: "development",
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    const giveUp = setTimeout(
      () => reject(new Error(`instance on ${port} never came up`)),
      45_000
    );
    const watch = (buf: unknown) => {
      const line = String(buf);
      if (line.includes(String(port)) || line.includes("listening")) {
        clearTimeout(giveUp);
        // The port is logged from the listen callback; the socket server is
        // attached by then, but the adapter's LISTEN is still in flight.
        setTimeout(() => resolve({ port, child }), 600);
      }
    };
    child.stdout?.on("data", watch);
    child.stderr?.on("data", watch);
  });
}
