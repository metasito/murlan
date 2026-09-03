import { createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { logger } from "./logger.ts";
import { payload } from "./payload.ts";

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

async function runGit(args: string[], cwd: string) {
  await execFileAsync("git", args, {
    cwd,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function gitOutput(args: string[], cwd: string): Promise<string> {
  return (await execFileAsync("git", args, { cwd })).stdout.trim();
}

/**
 * A refusal this hook is willing to say out loud.
 *
 * Everything else that can fail here is a git command, and git puts its own
 * stderr in the rejection — which carries the remote URL, and so the token in
 * it, and absolute workspace paths. The caller publishes what it is told into
 * a GitHub issue on a public repository, so only these curated sentences may
 * cross the wire; the rest stays in the log.
 */
export class DevSyncRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevSyncRefusal";
  }
}

// This hook exists to keep the dev preview mirroring origin/main, not to
// protect local history: whatever the checkout looks like — uncommitted
// edits, untracked files, an agent's own unpushed commits, a genuine
// divergence — none of it may block the sync. Uncommitted state gets
// stashed (never dropped) and local main is always pointed at exactly
// origin/main afterwards, no comparison or path-based judgment involved.
export async function syncMain(cwd: string = process.cwd()): Promise<SyncResult> {
  const before = await gitOutput(["rev-parse", "HEAD"], cwd);
  const originalBranch = await gitOutput(["branch", "--show-current"], cwd);

  const dirty = await gitOutput(
    ["status", "--porcelain", "--untracked-files=all"],
    cwd
  );
  if (dirty) {
    await runGit(
      [
        "stash",
        "push",
        "--include-untracked",
        "--quiet",
        "-m",
        "dev-sync: auto-stash before syncing to origin/main",
      ],
      cwd
    );
  }

  await runGit(["fetch", "origin", "main", "--quiet"], cwd);
  try {
    await runGit(["checkout", "-B", "main", "origin/main", "--quiet"], cwd);
  } catch (error) {
    if (originalBranch && originalBranch !== "main") {
      await runGit(["checkout", originalBranch, "--quiet"], cwd).catch(() => {});
    }
    throw error;
  }

  const sha = await gitOutput(["rev-parse", "HEAD"], cwd);
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
      return res.status(503).json({ ...payload("DEV_SYNC_NOT_CONFIGURED") });
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
      return res.status(401).json({ ...payload("INVALID_WEBHOOK_SIGNATURE") });
    }

    if (req.header("x-github-event") !== "push") {
      return res.status(204).end();
    }

    const push = req.body as GitHubPush;
    if (push.ref !== "refs/heads/main") {
      return res.status(202).json({ ignored: true, reason: "Not a main push", code: "IGNORED_NON_MAIN_PUSH" });
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
      // Whoever is told about this runs on another machine and cannot read
      // this log, so the reason has to travel with the response.
      return res.status(409).json({
        ...payload("DEV_SYNC_FAILED"),
        reason:
          error instanceof DevSyncRefusal
            ? error.message
            : "a git command failed; the reason is in the dev preview's log",
      });
    }
  };
}

export function registerGithubDevSyncHook(
  app: Express,
  deps?: HookDeps
) {
  app.post("/api/hooks/github", createGithubDevSyncHandler(deps));
}