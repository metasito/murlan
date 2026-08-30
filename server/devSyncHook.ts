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

async function runGit(args: string[], cwd: string) {
  await execFileAsync("git", args, {
    cwd,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function gitOutput(args: string[], cwd: string): Promise<string> {
  return (await execFileAsync("git", args, { cwd })).stdout.trim();
}

async function isAncestor(ancestor: string, descendant: string, cwd: string): Promise<boolean> {
  try {
    await runGit(["merge-base", "--is-ancestor", ancestor, descendant], cwd);
    return true;
  } catch {
    return false;
  }
}

// This workspace's own checkpointing commits agent-memory notes locally
// without pushing them, which used to permanently wedge the sync the moment
// origin/main moved on. Those notes are disposable scratch space, not work
// the sync needs to protect — so if every local-only commit touches nothing
// outside this prefix, it is safe to drop them and fast-forward anyway.
const DISCARDABLE_LOCAL_PATH_PREFIX = ".agents/memory/";

async function localOnlyCommitsAreDiscardable(
  localMain: string,
  remoteMain: string,
  cwd: string
): Promise<boolean> {
  const revList = await gitOutput(["rev-list", `${remoteMain}..${localMain}`], cwd);
  const commits = revList ? revList.split("\n") : [];
  if (commits.length === 0) return false;

  for (const commit of commits) {
    const changed = await gitOutput(
      ["diff-tree", "--no-commit-id", "--name-only", "-r", commit],
      cwd
    );
    const paths = changed ? changed.split("\n") : [];
    if (paths.length === 0) continue;
    if (!paths.every((p) => p.startsWith(DISCARDABLE_LOCAL_PATH_PREFIX))) {
      return false;
    }
  }
  return true;
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

export async function syncMain(cwd: string = process.cwd()): Promise<SyncResult> {
  const originalBranch = await gitOutput(["branch", "--show-current"], cwd);
  const before = await gitOutput(["rev-parse", "HEAD"], cwd);
  const dirty = await gitOutput(
    ["status", "--porcelain", "--untracked-files=all"],
    cwd
  );
  if (dirty) {
    throw new DevSyncRefusal("Dev workspace is not clean; refusing automatic main sync");
  }

  await runGit(["fetch", "origin", "main", "--quiet"], cwd);
  try {
    await runGit(["checkout", "main", "--quiet"], cwd);
    const localMain = await gitOutput(["rev-parse", "HEAD"], cwd);
    const remoteMain = await gitOutput(["rev-parse", "origin/main"], cwd);
    if (localMain === remoteMain) return { updated: before !== localMain, sha: localMain };
    if (await isAncestor(localMain, remoteMain, cwd)) {
      await runGit(["merge", "--ff-only", "origin/main", "--quiet"], cwd);
    } else if (await isAncestor(remoteMain, localMain, cwd)) {
      // A local commit has not reached GitHub yet. Leave it alone; the push
      // action will run after it is published, at which point this relation
      // reverses for the next remote main commit.
      return { updated: false, sha: localMain };
    } else if (await localOnlyCommitsAreDiscardable(localMain, remoteMain, cwd)) {
      await runGit(["reset", "--hard", "origin/main", "--quiet"], cwd);
    } else {
      throw new DevSyncRefusal("Local main and origin/main diverged; refusing automatic sync");
    }
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
      return res.status(503).json({ error: "Dev sync hook is not configured", code: "DEV_SYNC_NOT_CONFIGURED" });
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
      return res.status(401).json({ error: "Invalid webhook signature", code: "INVALID_WEBHOOK_SIGNATURE" });
    }

    if (req.header("x-github-event") !== "push") {
      return res.status(204).end();
    }

    const payload = req.body as GitHubPush;
    if (payload.ref !== "refs/heads/main") {
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
        error: "Dev sync was not applied",
        code: "DEV_SYNC_FAILED",
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