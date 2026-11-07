import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

export interface Instance {
  port: number;
  child: ChildProcess;
}

const SERVING = /serving on port (\d+)\D/;
const OUTPUT_KEPT = 16 * 1024;

/**
 * A real server process against `databaseUrl`, on the port the OS gave it; killed if it never
 * comes up. Its output is kept, and printed if it fails to start or later exits non-zero.
 */
export async function boot(databaseUrl: string, env: Record<string, string> = {}): Promise<Instance> {
  const child = spawn(
    process.execPath,
    ["server/index.ts"],
    {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        SESSION_SECRET: "cross-instance-secret",
        NODE_ENV: "development",
        ...env,
        PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let output = "";
  const keep = (buf: unknown) => {
    output = (output + String(buf)).slice(-OUTPUT_KEPT);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let up = false;
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const fail = (why: string) => reject(new Error(`instance ${why}; its output:\n${output}`));
      giveUp = setTimeout(() => fail("never came up"), 45_000);
      child.once("exit", (code, signal) => fail(`exited with ${code ?? signal} before it came up`));
      child.once("error", (err) => fail(`did not start: ${err.message}`));
      const watch = () => {
        const bound = SERVING.exec(output);
        if (!bound) return;
        child.stdout?.off("data", watch);
        clearTimeout(giveUp);
        // The port is logged from the listen callback; the socket server is
        // attached by then, but the adapter's first read from Redis is still in flight.
        setTimeout(() => resolve(Number(bound[1])), 600);
      };
      child.stdout?.on("data", watch);
    });
    up = true;
    child.once("exit", (code) => {
      if (code) process.stderr.write(`instance on ${port} exited with ${code}; its output:\n${output}\n`);
    });
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

export const at = (port: number) => `http://127.0.0.1:${port}`;

/** An account registered through the instance on `port`, signed in there. */
export async function accountOn(port: number, username: string): Promise<{ cookie: string; id: string }> {
  const res = await fetch(`${at(port)}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "password123", email: `${username}@example.test` }),
  });
  assert.equal(res.status, 202, `register ${username}: ${await res.text()}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const me = await fetch(`${at(port)}/api/auth/me`, { headers: { cookie } });
  return { cookie, id: ((await me.json()) as { id: string }).id };
}

/** `a` asks, `b` (named `bName`) accepts, through the instance on `port`. */
export async function befriendOn(port: number, a: { cookie: string }, b: { cookie: string }, bName: string): Promise<void> {
  const post = (cookie: string, path: string, body?: unknown) =>
    fetch(`${at(port)}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body ?? {}) });
  assert.equal((await post(a.cookie, "/api/friends/add", { username: bName })).status, 200);
  const requests = (await (await fetch(`${at(port)}/api/friends/requests`, { headers: { cookie: b.cookie } })).json()) as { id: string }[];
  assert.equal((await post(b.cookie, `/api/friends/accept/${requests[0]!.id}`)).status, 200);
}
