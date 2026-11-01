import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

export interface Instance {
  port: number;
  child: ChildProcess;
}

/**
 * `n` distinct ports nothing holds now. The server listens with `reusePort`, so a fixed port
 * another checkout's suite also uses splits this suite's requests between two servers.
 */
export async function freePorts(n: number): Promise<number[]> {
  const probes = Array.from({ length: n }, () => net.createServer());
  await Promise.all(probes.map((p) => new Promise<void>((resolve) => p.listen(0, "127.0.0.1", resolve))));
  const ports = probes.map((p) => (p.address() as net.AddressInfo).port);
  await Promise.all(probes.map((p) => new Promise<void>((resolve) => p.close(() => resolve()))));
  return ports;
}

/** A real server process on `port`, against `databaseUrl`; killed if it never comes up. */
export async function boot(
  port: number,
  databaseUrl: string,
  env: Record<string, string> = {}
): Promise<Instance> {
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
  let up = false;
  let giveUp: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      giveUp = setTimeout(() => reject(new Error(`instance on ${port} never came up`)), 45_000);
      child.once("exit", (code) => reject(new Error(`instance on ${port} exited with ${code} before it came up`)));
      child.once("error", (err) => reject(new Error(`instance on ${port} did not start: ${err.message}`)));
      const watch = (buf: unknown) => {
        const line = String(buf);
        if (line.includes(String(port)) || line.includes("listening")) {
          clearTimeout(giveUp);
          // The port is logged from the listen callback; the socket server is
          // attached by then, but the adapter's first read from Redis is still in flight.
          setTimeout(resolve, 600);
        }
      };
      child.stdout?.on("data", watch);
      child.stderr?.on("data", watch);
    });
    up = true;
    return { port, child };
  } finally {
    clearTimeout(giveUp);
    if (!up) child.kill("SIGKILL");
  }
}

/** Kills `child` and resolves once it has exited, which is when its listening port is free again. */
export function stopInstance(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  return exited;
}
