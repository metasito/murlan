// tools/loop/tests/evidenceKey.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultKeyFile, evidenceKey, mac, macEquals } from "../evidence.mjs";
import { spawnEnv, supervisorConfig } from "../session-env.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "evidence-key-"));
const keyFile = path.join(dir, "state", "evidence.key");

test("the supervisor's key is made once, kept at the configured path, and read back after a restart", () => {
  const env = { LOOP_EVIDENCE_KEY_FILE: keyFile };
  const key = evidenceKey(env);
  assert.equal(key.length, 32);
  assert.equal(readFileSync(keyFile, "utf8"), key.toString("hex"));
  if (process.platform !== "win32") assert.equal(statSync(keyFile).mode & 0o077, 0, "owner-only");
  assert.deepEqual(evidenceKey({ ...env }), key);
  assert.equal(macEquals(mac(key, "a", "b"), mac(evidenceKey(env), "a", "b")), true);
  assert.equal(macEquals(mac(key, "ab"), mac(key, "a", "b")), false, "parts are length-prefixed");
});

test("a key file that is not a key is refused, never replaced", () => {
  const bad = path.join(dir, "bad.key");
  writeFileSync(bad, "not a key");
  assert.throws(() => evidenceKey({ LOOP_EVIDENCE_KEY_FILE: bad }), /does not hold an evidence key/);
  assert.equal(readFileSync(bad, "utf8"), "not a key");
});

test("a session is handed neither the key's path nor the key, and has none", () => {
  const base = { LOOP_EVIDENCE_KEY_FILE: keyFile, PATH: "p" };
  assert.deepEqual(supervisorConfig(base), { evidenceKeyFile: keyFile });
  const session = spawnEnv({ number: 5, turns: 40 }, base);
  assert.equal(Object.values(session).filter((v) => v !== undefined).some((v) => String(v).includes("evidence")), false);
  assert.equal(session.LOOP_EVIDENCE_KEY_FILE, undefined);
  assert.deepEqual(supervisorConfig({ ...base, LOOP_TURNS: "40" }), {});
  assert.throws(() => evidenceKey({ ...base, LOOP_TURNS: "40" }), /no evidence key/);
});

test("the default key sits in per-user state, never in the checkout", () => {
  assert.equal(defaultKeyFile({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32", "C:\\Users\\u"), path.join("C:\\Users\\u\\AppData\\Local", "murlan-loop", "evidence.key"));
  assert.equal(defaultKeyFile({}, "linux", "/home/u"), path.join("/home/u", ".local", "state", "murlan-loop", "evidence.key"));
  assert.equal(defaultKeyFile({ XDG_STATE_HOME: "/s" }, "linux", "/home/u"), path.join("/s", "murlan-loop", "evidence.key"));
});

test("cleanup", () => rmSync(dir, { recursive: true, force: true }));
