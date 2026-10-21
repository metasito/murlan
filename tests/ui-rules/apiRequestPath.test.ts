// tests/ui-rules/apiRequestPath.test.ts — every client request to the server goes through
// lib/query-client.ts's api(), which takes its URL and types from shared/http.ts (#1715).
// Each list below is exact: a new request, base-URL read or fetch anywhere fails until it is
// named here, so a reviewer sees it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const owner = "lib/query-client.ts";

/** Source with comments blanked; a `//` right after `:` is a URL, not a comment. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function clientSources(): [string, string][] {
  return ["app", "components", "context", "lib"].flatMap((dir) =>
    readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .map((f): [string, string] => {
        const rel = path.posix.join(dir, f.split(path.sep).join("/"));
        return [rel, readFileSync(path.join(repoRoot, rel), "utf8")];
      })
      .filter(([file]) => file !== owner)
  );
}

/** The text of the first argument of each call to `name`, as `file: argument`. */
function calls(name: string): string[] {
  return clientSources().flatMap(([file, src]) => {
    const text = code(src);
    return [...text.matchAll(new RegExp(`\\b${name}\\(`, "g"))].map((m) => {
      let depth = 0;
      let end = m.index + m[0].length;
      for (; end < text.length; end++) {
        const c = text[end];
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) {
          if (depth === 0) break;
          depth--;
        } else if (c === "," && depth === 0) break;
      }
      return `${file}: ${text.slice(m.index + m[0].length, end).trim()}`;
    });
  });
}

/** Mentions of `name` that are neither a call nor a plain named import — an alias, a reference passed on. */
function uncalled(name: string): string[] {
  return clientSources().flatMap(([file, src]) =>
    [...code(src).matchAll(new RegExp(`\\b${name}\\b(?!\\s*\\()`, "g"))]
      .filter((m) => !/^\s*[,}]/.test(code(src).slice(m.index + name.length)))
      .map(() => file)
  );
}

test("only api()'s module spells an api/ path; everyone else names a contract route", () => {
  const spelled = clientSources()
    .filter(([, src]) => /\/api\/|["'`]api\//.test(src))
    .map(([file]) => file);
  assert.deepEqual(spelled, []);
});

test("only api()'s module imports expo/fetch or reaches for XMLHttpRequest", () => {
  const found = clientSources()
    .filter(([, src]) => /["']expo\/fetch["']|\bXMLHttpRequest\b/.test(code(src)))
    .map(([file]) => file);
  assert.deepEqual(found, []);
});

test("every fetch outside api() is fetchMe or fetchSocketTicket (D9), or one that never reaches the server", () => {
  assert.deepEqual(calls("fetch").sort(), [
    'context/AuthContext.tsx: ...requestOf("GET auth/me")',
    "lib/device/audioEngine.web.ts: file as unknown as string",
    "lib/diagnostics/recorder.ts: target",
    'lib/socket.ts: ...requestOf("POST auth/socket-ticket")',
  ]);
  assert.deepEqual(uncalled("fetch"), []);
});

test("the server's address is read only for the D9 pair, the socket origin and the share link", () => {
  assert.deepEqual([...calls("getApiUrl"), ...calls("requestOf")].sort(), [
    "app/(online)/room.tsx: ",
    'context/AuthContext.tsx: "GET auth/me"',
    "lib/socket.ts: ",
    'lib/socket.ts: "POST auth/socket-ticket"',
  ]);
  assert.deepEqual([...uncalled("getApiUrl"), ...uncalled("requestOf")], []);
});
