import { createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { logger } from "./logger.ts";

const execFileAsync = promisify(execFile);
export const DEV_SYNC_TRIGGER_FILE =
  process.env.MURLAN_DEV_SYNC_TRIGGER_FILE || "/tmp/murlan-dev-sync.trigger";

type GitHubPush = {
  ref?: unknown;
  after?: unknown;
};

type SyncResult = {
  updated: boolean;
  sha: string;
};

type HookDeps = {
  secret?: string;
  sync?: () => Promise<SyncResult>;
  triggerFile?: string;
};

function signatureMatches(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`,
    "utf8"
  );
  const received = Buffer.from(signature, "utf8");
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

async function runGit(args: string[]) {
  await execFileAsync("git", args, {
    cwd: process.cwd(),
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function gitOutput(args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd: process.cwd() })).stdout.trim();
}

async function isAncestor(ancestor: string, descendant: string): Promise<boolean> {
  try {
    await runGit(["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

export async function syncMain(): Promise<SyncResult> {
  const originalBranch = await gitOutput(["branch", "--show-current"]);
  const before = await gitOutput(["rev-parse", "HEAD"]);
  const dirty = await gitOutput([
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  if (dirty) {
    throw new Error("Dev workspace is not clean; refusing automatic main sync");
  }

  await runGit(["fetch", "origin", "main", "--quiet"]);
  try {
    await runGit(["checkout", "main", "--quiet"]);
    const localMain = await gitOutput(["rev-parse", "HEAD"]);
    const remoteMain = await gitOutput(["rev-parse", "origin/main"]);
    if (localMain === remoteMain) return { updated: before !== localMain, sha: localMain };
    if (await isAncestor(localMain, remoteMain)) {
      await runGit(["merge", "--ff-only", "origin/main", "--quiet"]);
    } else if (await isAncestor(remoteMain, localMain)) {
      // A local commit has not reached GitHub yet. Leave it alone; the push
      // action will run after it is published, at which point this relation
      // reverses for the next remote main commit.
      return { updated: false, sha: localMain };
    } else {
      throw new Error("Local main and origin/main diverged; refusing automatic sync");
    }
  } catch (error) {
    if (originalBranch && originalBranch !== "main") {
      await runGit(["checkout", originalBranch, "--quiet"]).catch(() => {});
    }
    throw error;
  }

  const sha = await gitOutput(["rev-parse", "HEAD"]);
  return { updated: before !== sha, sha };
}

export function createGithubDevSyncHandler({
  secret = process.env.REPLIT_DEV_HOOK_SECRET,
  sync = syncMain,
  triggerFile = DEV_SYNC_TRIGGER_FILE,
}: HookDeps = {}) {
  let inFlight: Promise<SyncResult> | undefined;

  return async function githubDevSyncHandler(req: Request, res: Response) {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).end();
    }
    if (!secret) {
      logger.error("REPLIT_DEV_HOOK_SECRET is not configured");
      return res.status(503).json({ error: "Dev sync hook is not configured" });
    }

    const rawBody = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(JSON.stringify(req.body ?? {}));
    if (
      !signatureMatches(
        rawBody,
        req.header("x-hub-signature-256"),
        secret
      )
    ) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    if (req.header("x-github-event") !== "push") {
      return res.status(204).end();
    }

    const payload = req.body as GitHubPush;
    if (payload.ref !== "refs/heads/main") {
      return res.status(202).json({ ignored: true, reason: "Not a main push" });
    }

    try {
      inFlight ??= sync().finally(() => {
        inFlight = undefined;
      });
      const result = await inFlight;
      if (result.updated) {
        await fs.mkdir(path.dirname(triggerFile), { recursive: true });
        await fs.writeFile(`${triggerFile}.next`, `${result.sha}\n`, "utf8");
        await fs.rename(`${triggerFile}.next`, triggerFile);
      }
      return res.status(202).json({
        accepted: true,
        updated: result.updated,
        sha: result.sha,
      });
    } catch (error) {
      logger.error({ err: error }, "GitHub dev sync failed");
      return res.status(409).json({ error: "Dev sync was not applied" });
    }
  };
}

export function registerGithubDevSyncHook(
  app: Express,
  deps?: HookDeps
) {
  app.post("/api/hooks/github", createGithubDevSyncHandler(deps));
}