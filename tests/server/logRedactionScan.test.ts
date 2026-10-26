// tests/server/logRedactionScan.test.ts — the source scan split out of logRedaction.test.ts so the mutation run keeps that file's behaviour tests
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { REDACT_PATHS } from "../../server/shared/logger.ts";
import { blankComments, blankStrings } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const schemas = readFileSync(path.join(repoRoot, "shared", "socketSchemas.ts"), "utf8");

/** Every object key declared in the socket schemas, comments stripped. */
function schemaFields(): string[] {
  const source = blankComments(schemas);
  const fields = new Set<string>();
  for (const m of source.matchAll(/^\s{2,}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)) fields.add(m[1]);
  return [...fields];
}

/** Every `.ts` under `server/`, at any depth, so a later split cannot narrow the scan. */
function serverSources(dir = path.join(repoRoot, "server")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return serverSources(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

/** The leading `{…}` of a call's arguments — the fields, without the message after them. */
function firstObjectArg(blank: string): number {
  const lead = blank.length - blank.trimStart().length;
  if (blank[lead] !== "{") return 0;
  let depth = 0;
  for (let i = lead; i < blank.length; i += 1) {
    if (blank[i] === "{") depth += 1;
    else if (blank[i] === "}" && (depth -= 1) === 0) return i + 1;
  }
  return blank.length;
}

/**
 * Every `logger.<level>(…)` call under `server/`, as its fields and its whole
 * argument text. Structure is read off `blankStrings`, so neither a brace nor a
 * paren inside a message can cut a slice short; `args` is the real text, which
 * is what the crash-report rule below finds its own subject by.
 *
 * The rules read `fields`, not `args`: a message is prose, and "handed the seat
 * to, then took it back" is not a privacy defect.
 */
function loggerCalls(): { file: string; fields: string; args: string }[] {
  const calls: { file: string; fields: string; args: string }[] = [];
  for (const full of serverSources()) {
    const file = path.relative(path.join(repoRoot, "server"), full);
    const src = readFileSync(full, "utf8");
    const blank = blankStrings(src);
    for (const m of blank.matchAll(/\blogger\.(?:trace|debug|info|warn|error|fatal)\(/g)) {
      const start = m.index + m[0].length;
      let depth = 1;
      let i = start;
      while (i < blank.length && depth > 0) {
        if (blank[i] === "(") depth += 1;
        else if (blank[i] === ")") depth -= 1;
        i += 1;
      }
      const end = i - 1;
      calls.push({
        file,
        fields: src.slice(start, start + firstObjectArg(blank.slice(start, end))),
        args: src.slice(start, end),
      });
    }
  }
  return calls;
}

describe("what a refused socket event leaves in the log", () => {
  test("the schemas declare fields to scan at all", () => {
    const fields = schemaFields();
    assert.ok(fields.includes("roomCode"), `scan found ${fields.length} fields but not roomCode`);
    assert.ok(fields.includes("cardIds"), "the scan is not reading the schemas");
  });

  test("every code-shaped payload field is redacted", () => {
    for (const field of schemaFields().filter((f) => /code$/i.test(f))) {
      assert.ok(
        REDACT_PATHS.includes(`payload.${field}`),
        `${field} is a socket payload field that reads like a room code and is logged in the ` +
          `clear — add "payload.${field}" to REDACT_PATHS in server/shared/logger.ts`
      );
    }
  });
});

describe("what a hand-written line may name", () => {
  test("the scan reads the calls it is a rule about", () => {
    // The floor: every assertion below passes on an empty list.
    const calls = loggerCalls();
    assert.ok(calls.length > 20, `the scan found ${calls.length} logger calls under server/`);
    for (const file of ["http/mail.ts", "http/routes/auth.ts", "http/accountMail.ts", "socket/socketSafety.ts", "socket/lobbyIntents.ts"].map(path.normalize))
      assert.ok(calls.some((c) => c.file === file), `the scan is not reading server/${file}`);
    assert.ok(
      calls.some((c) => c.fields.includes("userId")),
      "no call's fields were read — firstObjectArg is returning nothing"
    );
  });

  test("no call is exempt from the rules by the shape of its first argument", () => {
    // With no `{…}` to read, every rule below passes on the empty string. A
    // message-only line has nothing to hide; anything else — a bound object, a
    // spread — has to be looked at rather than skipped.
    for (const { file, fields, args } of loggerCalls())
      assert.ok(
        fields !== "" || /^\s*["'`]/.test(args),
        `server/${file}: a logger call passes something other than a literal object, which the ` +
          `rules below cannot read: ${args.slice(0, 60)}`
      );
  });

  test("no line names an email address", () => {
    // `to` is the recipient's address at every call site that binds it, so the
    // rule is the name rather than a list of lines. `userId` is what a failed
    // send is diagnosed from; the address adds nothing a log stream — which has
    // no retention window and no deletion path — should outlive the account
    // with. The quote is for `{ "to": … }`, which is the same field.
    for (const { file, fields } of loggerCalls())
      assert.equal(
        /\bto\b"?\s*[,:}]/.test(fields),
        false,
        `server/${file}: a logger call passes \`to\`, the address a message was sent to`
      );
  });

  test("no line names a live room code", () => {
    // The credential `REDACT_PATHS` keeps out of a refused socket event is the
    // same credential when a handler logs it directly, where no redact path
    // reaches it: `payload.code` is a path, and a top-level `code` is a
    // refusal's own reason, which the suite above asserts is kept.
    for (const { file, fields } of loggerCalls())
      assert.equal(
        /\broom\.code\b|\broomCode\b/.test(fields),
        false,
        `server/${file}: a logger call passes a room code, the sole credential for joining that table`
      );
  });

  test("a crash report is not copied beside the row that expires it", () => {
    const reported = loggerCalls().filter((c) => c.args.includes("Client reported an unhandled error"));
    assert.equal(reported.length, 1, "the crash-report line was renamed or removed — this rule lost its subject");
    for (const field of ["userId", "clientError", "message", "stack"])
      assert.equal(
        reported[0].fields.includes(field),
        false,
        `the crash-report log line still carries ${field} — client_errors is swept at 90 days and ` +
          `cleared by deleteUser, and a copy in the log is reached by neither`
      );
  });

  test("a crash report the database refused does not reach the log either", () => {
    // The tempting exception, and why there is none: a client chooses its own
    // `message`, and a NUL in it fails this insert every time — so the fallback
    // would be a way to write arbitrary text into a stream nothing sweeps.
    const failed = loggerCalls().filter((c) => c.args.includes("Failed to store a client error report"));
    assert.equal(failed.length, 1);
    // `report.platform` is the bounded enum, and is not the report.
    for (const field of [/\breport\b(?!\.platform)/, /\buserId\b/, /\bmessage\b/, /\bstack\b/])
      assert.equal(field.test(failed[0].fields), false, `the fallback line carries ${field}`);
  });
});

describe("what a completed request leaves in the log", () => {
  test("server/app.ts mounts that middleware rather than building its own", () => {
    const app = readFileSync(path.join(repoRoot, "server", "app.ts"), "utf8");
    assert.match(
      app,
      /app\.use\(createRequestLogger\(\)\)/,
      "server/app.ts no longer mounts createRequestLogger() — the serializers below it are unreached"
    );
    assert.equal(
      /pinoHttp\s*\(/.test(app),
      false,
      "server/app.ts builds its own pino-http options — the serializers that keep the client IP out " +
        "of the log live in server/http/logger.ts, and a second options object silently bypasses them"
    );
    // The floor under `loggedRequest`'s wildcard rule, and under the `catchAll`
    // harness above, which is a hand copy of this mount.
    assert.match(
      app,
      /app\.get\("\*path"/,
      "the SPA catch-all is no longer a GET on `*path` — the harness above copies that shape, and the " +
        "rule that drops a wildcard address is written for it"
    );
    // The floor under `kind: "shell"`: without this line every missing build
    // file reads as a served one, and the suite above would only be testing its
    // own harness.
    assert.match(
      app,
      /\[ANSWERED_BY_SHELL\] = true/,
      "the SPA catch-all no longer marks what it answered — a lost bundle and a served one " +
        "are the same log line again"
    );
    assert.equal(
      (app.match(/app\.(get|post|put|patch|delete|use)\("[^"]*\*/g) ?? []).length,
      1,
      "server/app.ts has a second wildcard route — every address it touches is dropped from the log, " +
        "which is right for the SPA shell and wrong for a route that means to answer"
    );
  });

  test("docs/PRIVACY.md still claims what the line actually holds", () => {
    // The policy is written to be published, so every clause of it is one the
    // suite above also asserts. This cannot check the prose against the code —
    // it can only refuse to let a clause outlive the assertion that earns it.
    const policy = readFileSync(path.join(repoRoot, "docs", "PRIVACY.md"), "utf8");
    for (const claim of [
      /Your IP address is not written/,
      /neither are your request headers/,
      /anything you passed in the address's query string/,
      /written only when it matches one\s+of our own routes/,
      /then only in that route's general form rather than as you sent it/,
      /when it matches\s+none of them[\s\S]{0,300}no address is\s+written at all/,
      /only one of four fixed words of our own saying which part of the service was\s+asked for/,
      /never your email address and never the contents\s+of a crash report/,
      /your username where the action was about it/,
      /no id from the address, which is written only when it matches one of our own routes and then only in that route's general form/,
    ])
      assert.match(policy, claim, `docs/PRIVACY.md no longer states ${claim}`);
  });
});
