// tests/ui-rules/apiRequestPath.test.ts — every client request to the server goes through
// lib/query-client.ts's api(), which takes its URL and types from shared/http.ts (#1715).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const owner = "lib/query-client.ts";

function clientSources(): [string, string][] {
  return ["app", "components", "context", "lib"].flatMap((dir) =>
    readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .map((f): [string, string] => {
        const rel = path.posix.join(dir, f.split(path.sep).join("/"));
        return [rel, readFileSync(path.join(repoRoot, rel), "utf8")];
      })
  );
}

test("only api()'s module spells an /api/ path; everyone else names a contract route", () => {
  const spelled = clientSources()
    .filter(([file, src]) => file !== owner && src.includes("/api/"))
    .map(([file]) => file);
  assert.deepEqual(spelled, []);
});

const notTheServer: Record<string, string> = {
  "lib/device/audioEngine.web.ts": "reads a bundled sound asset",
  "lib/diagnostics/recorder.ts": "posts to the bench log host",
};

test("a raw fetch outside api() is fetchMe or fetchSocketTicket (D9), on a urlOf URL, or not the server", () => {
  const raw = clientSources().flatMap(([file, src]) =>
    file === owner || file in notTheServer
      ? []
      : [...src.matchAll(/\bfetch\((\w+\([^)]*\)|[^,)]*)/g)].map((m) => `${file}: ${m[1]}`)
  );
  assert.deepEqual(raw.sort(), [
    'context/AuthContext.tsx: urlOf("GET auth/me")',
    'lib/socket.ts: urlOf("POST auth/socket-ticket")',
  ]);
  for (const file of Object.keys(notTheServer)) {
    assert.doesNotMatch(readFileSync(path.join(repoRoot, file), "utf8"), /urlOf|getApiUrl/, file);
  }
});
