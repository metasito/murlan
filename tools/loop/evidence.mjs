/**
 * The supervisor's key, and the MAC it signs the loop's evidence with: a ledger row, a stream line, a
 * report entry. Evidence is whatever verifies under it, so the files a session can write decide nothing.
 *
 * The key is made once and kept outside the repo, at the path `supervisorConfig` gives or a per-user
 * state directory. A loop session gets neither the path nor the key (`spawnEnv`), and this module
 * refuses to run inside one.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fromEnv, supervisorConfig } from "./session-env.mjs";

/**
 * Per-user state, never the checkout: `%LOCALAPPDATA%\murlan-loop` on Windows, else `$XDG_STATE_HOME` or `~/.local/state`.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [platform]
 * @param {string} [home]
 */
export function defaultKeyFile(env = process.env, platform = process.platform, home = os.homedir()) {
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "murlan-loop", "evidence.key");
  return path.join(env.XDG_STATE_HOME || path.join(home, ".local", "state"), "murlan-loop", "evidence.key");
}

const keys = new Map();

/** @param {Record<string, string | undefined>} [env] @returns {Buffer} */
export function evidenceKey(env = process.env) {
  if (fromEnv(env).loop) throw new Error("a loop session has no evidence key");
  const configured = supervisorConfig(env).evidenceKeyFile;
  const file = configured ?? defaultKeyFile(env);
  if (!configured && process.env.NODE_TEST_CONTEXT) throw new Error(`a test run resolved the real evidence key path (${file}); run it through scripts/nodeTest.mjs`);
  const known = keys.get(file);
  if (known) return known;
  const read = () => {
    const hex = fs.readFileSync(file, "utf8").trim();
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`${file} does not hold an evidence key`);
    return Buffer.from(hex, "hex");
  };
  let key;
  try {
    key = read();
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      fs.writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
    } catch (again) {
      if (again?.code !== "EEXIST") throw again;
    }
    key = read();
  }
  keys.set(file, key);
  return key;
}

/** HMAC-SHA256 over length-prefixed parts, so no two part lists read as one string. */
export function mac(key, ...parts) {
  const h = createHmac("sha256", key);
  for (const part of parts) {
    const bytes = Buffer.from(String(part));
    h.update(`${bytes.length}:`);
    h.update(bytes);
  }
  return h.digest("hex");
}

export const macEquals = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
