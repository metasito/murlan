import { createHmac } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { DevSyncRefusal, createGithubDevSyncHandler } from "../server/devSyncHook.ts";

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
