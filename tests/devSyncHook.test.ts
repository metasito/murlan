import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { DevSyncRefusal, createGithubDevSyncHandler, syncMain } from "../server/devSyncHook.ts";

const execFileAsync = promisify(execFile);

type MockRequest = {
  body: unknown;
  rawBody: Buffer;
  header(name: string): string | undefined;
};

type MockResponse = {
  result: { status: number; body: unknown };
  status(code: number): MockResponse;
  json(body: unknown): MockResponse;
  end(): MockResponse;
};

function request(body: unknown, secret: string, event = "push"): MockRequest {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = `sha256=${createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;
  return {
    body,
    rawBody,
    header(name: string) {
      return {
        "x-hub-signature-256": signature,
        "x-github-event": event,
      }[name.toLowerCase()];
    },
  };
}

function response(): MockResponse {
  const result = { status: 200, body: undefined as unknown };
  return {
    result,
    status(code: number) {
      result.status = code;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

test("accepts a signed main push and writes the restart trigger", async () => {
  const dir = await mkdtemp(join(tmpdir(), "murlan-dev-hook-"));
  const triggerFile = join(dir, "trigger");
  const res = response();
  const handler = createGithubDevSyncHandler({
    secret: "test-secret",
    triggerFile,
    sync: async () => ({ updated: true, sha: "abc123" }),
  });

  await handler(
    request({ ref: "refs/heads/main" }, "test-secret") as Request,
    res as unknown as Response
  );

  assert.equal(res.result.status, 202);
  assert.deepEqual(res.result.body, {
    accepted: true,
    updated: true,
    sha: "abc123",
  });
  assert.equal(await readFile(triggerFile, "utf8"), "abc123\n");
});

test("rejects an invalid signature without syncing", async () => {
  let synced = false;
  const res = response();
  const handler = createGithubDevSyncHandler({
    secret: "test-secret",
    sync: async () => {
      synced = true;
      return { updated: true, sha: "abc123" };
    },
  });

  await handler(
    request({ ref: "refs/heads/main" }, "wrong-secret") as Request,
    res as unknown as Response
  );

  assert.equal(res.result.status, 401);
  assert.equal(synced, false);
});

test("ignores pushes for branches other than main", async () => {
  let synced = false;
  const res = response();
  const handler = createGithubDevSyncHandler({
    secret: "test-secret",
    sync: async () => {
      synced = true;
      return { updated: true, sha: "abc123" };
    },
  });

  await handler(
    request({ ref: "refs/heads/feature" }, "test-secret") as Request,
    res as unknown as Response
  );

  assert.equal(res.result.status, 202);
  assert.deepEqual(res.result.body, {
    ignored: true,
    reason: "Not a main push",
    code: "IGNORED_NON_MAIN_PUSH",
  });
  assert.equal(synced, false);
});
// A dirty workspace and a diverged main need opposite remedies, and the
// workflow that reports the failure cannot read this server's log.
test("a refused sync reports which refusal it was", async () => {
  const secret = "s3cret";
  const handler = createGithubDevSyncHandler({
    secret,
    sync: async () => {
      throw new DevSyncRefusal("Dev workspace is not clean; refusing automatic main sync");
    },
    triggerFile: join(await mkdtemp(join(tmpdir(), "murlan-sync-")), "trigger"),
  });

  const res = response();
  await handler(
    request({ ref: "refs/heads/main", after: "abc123" }, secret) as unknown as Request,
    res as unknown as Response
  );

  assert.equal(res.result.status, 409);
  const body = res.result.body as { code?: string; reason?: string };
  assert.equal(body.code, "DEV_SYNC_FAILED");
  assert.match(
    body.reason ?? "",
    /not clean/,
    "the reason has to cross the wire — the workflow that reports this cannot read the server's log"
  );
});

test("the reason is the sync's own words, not a guess at them", async () => {
  const secret = "s3cret";
  const handler = createGithubDevSyncHandler({
    secret,
    sync: async () => {
      throw new DevSyncRefusal("Local main and origin/main diverged; refusing automatic sync");
    },
    triggerFile: join(await mkdtemp(join(tmpdir(), "murlan-sync-")), "trigger"),
  });

  const res = response();
  await handler(
    request({ ref: "refs/heads/main", after: "abc123" }, secret) as unknown as Request,
    res as unknown as Response
  );

  assert.match((res.result.body as { reason?: string }).reason ?? "", /diverged/);
});

// The message of anything that is not a curated refusal is a git rejection,
// which reads `Command failed: git <args>\n<git stderr>` — the remote URL and
// so any token in it, plus absolute workspace paths. The caller publishes what
// it is told into an issue on a public repository.
test("a git failure is not quoted back, only refusals are", async () => {
  const secret = "s3cret";
  const handler = createGithubDevSyncHandler({
    secret,
    sync: async () => {
      throw new Error(
        "Command failed: git fetch origin main\n" +
          "fatal: unable to access 'https://ghp_EXAMPLETOKEN@github.com/metasito/murlan.git/'"
      );
    },
    triggerFile: join(await mkdtemp(join(tmpdir(), "murlan-sync-")), "trigger"),
  });

  const res = response();
  await handler(
    request({ ref: "refs/heads/main", after: "abc123" }, secret) as unknown as Request,
    res as unknown as Response
  );

  assert.equal(res.result.status, 409);
  const reason = (res.result.body as { reason?: string }).reason ?? "";
  assert.doesNotMatch(reason, /ghp_/, "a credential must never reach the response body");
  assert.doesNotMatch(reason, /github\.com/);
  assert.doesNotMatch(reason, /Command failed/);
  assert.match(reason, /log/, "it still says where the detail is");
});

// This workspace's own checkpointing commits agent-memory notes locally
// without pushing them. That used to permanently wedge the sync the moment
// origin/main moved on, so a divergence confined to that path must be
// discarded and fast-forwarded through instead of refused.
async function git(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd });
}

async function initRepoPair() {
  const root = await mkdtemp(join(tmpdir(), "murlan-sync-repo-"));
  const remote = join(root, "remote.git");
  const clone = join(root, "clone");
  await git(root, ["init", "--bare", "-q", remote]);
  await git(root, ["clone", "-q", remote, clone]);
  await git(clone, ["config", "user.email", "test@example.com"]);
  await git(clone, ["config", "user.name", "Test"]);
  await writeFile(join(clone, "app.txt"), "v1\n", "utf8");
  await git(clone, ["add", "."]);
  await git(clone, ["commit", "-q", "-m", "initial"]);
  await git(clone, ["push", "-q", "origin", "HEAD:main"]);
  await git(clone, ["checkout", "-q", "-B", "main"]);
  return { remote, clone };
}

test("a divergence confined to .agents/memory/ is discarded, not refused", async () => {
  const { remote, clone } = await initRepoPair();

  // Someone else pushes real work to origin/main.
  const other = await mkdtemp(join(tmpdir(), "murlan-sync-other-"));
  await git(tmpdir(), ["clone", "-q", remote, other]);
  await git(other, ["config", "user.email", "test@example.com"]);
  await git(other, ["config", "user.name", "Test"]);
  await writeFile(join(other, "app.txt"), "v2\n", "utf8");
  await git(other, ["commit", "-q", "-am", "real work"]);
  await git(other, ["push", "-q", "origin", "main"]);

  // Meanwhile the local checkout gets an unpushed memory-only commit.
  await mkdir(join(clone, ".agents", "memory"), { recursive: true });
  await writeFile(join(clone, ".agents", "memory", "note.md"), "note\n", "utf8");
  await git(clone, ["add", "."]);
  await git(clone, ["commit", "-q", "-m", "agent memory note"]);

  const result = await syncMain(clone);

  assert.equal(result.updated, true);
  const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: clone })).stdout.trim();
  const originMain = (
    await execFileAsync("git", ["rev-parse", "origin/main"], { cwd: clone })
  ).stdout.trim();
  assert.equal(head, originMain, "local main should land exactly on origin/main");
  assert.equal(result.sha, originMain);
});

test("a divergence that touches real files outside .agents/memory/ is still refused", async () => {
  const { remote, clone } = await initRepoPair();

  const other = await mkdtemp(join(tmpdir(), "murlan-sync-other-"));
  await git(tmpdir(), ["clone", "-q", remote, other]);
  await git(other, ["config", "user.email", "test@example.com"]);
  await git(other, ["config", "user.name", "Test"]);
  await writeFile(join(other, "app.txt"), "v2\n", "utf8");
  await git(other, ["commit", "-q", "-am", "real work"]);
  await git(other, ["push", "-q", "origin", "main"]);

  // Local checkout has its own unpushed, non-memory commit.
  await writeFile(join(clone, "app.txt"), "local-edit\n", "utf8");
  await git(clone, ["commit", "-q", "-am", "local edit outside memory"]);

  await assert.rejects(() => syncMain(clone), DevSyncRefusal);
});
