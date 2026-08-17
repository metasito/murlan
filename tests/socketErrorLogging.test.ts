// tests/socketErrorLogging.test.ts — a bookkeeping write in server/socket.ts is
// fire-and-forget on purpose: it must never block or fail a hand. That shape is
// one character away from invisible, though. `.catch(() => {})` on
// `removeRoomPlayer` leaves the room_players row alive while the in-memory seat
// is vacated, and claimRoomSeat counts rows: the room reports itself full to the
// next joiner until the 24h sweeper reaches it, with nothing in the log to say
// why.
//
// This pins the half TypeScript cannot see — a handler that receives an error
// and does nothing with it. The check is on the *shape* of the handler, not on
// any literal spelling, so a future site written with different whitespace or an
// `async` handler is caught too.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCKET_SOURCE = path.join(repoRoot, "server", "socket.ts");

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function skipWs(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}

/** Index of the `}` closing the `{` at `open`, or -1. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * 1-based line numbers of every `.catch(` in `src` whose inline arrow handler
 * has an empty or comment-only block body.
 *
 * An expression-bodied handler is left alone: `.catch(() => null)` supplies a
 * fallback the caller then acts on, which is a different thing from discarding
 * the error. Anything this cannot parse — a named handler, a function
 * expression — is skipped rather than guessed at.
 */
function swallowingCatches(src: string): number[] {
  const found: number[] = [];
  for (const m of src.matchAll(/\.catch\s*\(/g)) {
    const start = m.index;
    let i = skipWs(src, start + m[0].length);
    if (src.startsWith("async", i)) i = skipWs(src, i + "async".length);

    if (src[i] === "(") {
      const close = src.indexOf(")", i);
      if (close === -1) continue;
      i = skipWs(src, close + 1);
    } else {
      const ident = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      if (!ident) continue;
      i = skipWs(src, i + ident[0].length);
    }

    if (!src.startsWith("=>", i)) continue;
    i = skipWs(src, i + 2);
    if (src[i] !== "{") continue;

    const end = matchBrace(src, i);
    if (end === -1) continue;

    if (stripComments(src.slice(i + 1, end)).trim() === "") {
      found.push(src.slice(0, start).split("\n").length);
    }
  }
  return found;
}

describe("server/socket.ts logs the bookkeeping writes that fail", () => {
  test("no promise catch discards its error", () => {
    const src = readFileSync(SOCKET_SOURCE, "utf8");
    const offenders = swallowingCatches(src);
    assert.deepEqual(
      offenders,
      [],
      "a catch handler that discards the error makes a failed room, seat or host write " +
        "invisible until a player reports the symptom. Log it instead:\n" +
        offenders.map((line) => `  server/socket.ts:${line}`).join("\n")
    );
  });

  test("the scanner flags a swallowing handler however it is spelled", () => {
    // Without this the parser could silently stop matching and the scan above
    // would pass while checking nothing — the exact failure mode this file
    // exists to prevent.
    const swallowing = `
      a().catch(() => {});
      b().catch( (  )   =>   {
        // nothing we can do
      } );
      c().catch(async (err) => {});
      d().catch(e => {\t});
      e()
        .catch(
          () => {}
        );
    `;
    assert.deepEqual(
      swallowingCatches(swallowing).length,
      5,
      "every one of these discards its error and must be flagged"
    );
  });

  test("the scanner leaves a handler that logs alone", () => {
    const logging = `
      a().catch((err) => logger.warn({ err, roomId }, "write failed"));
      b().catch((err) => {
        logger.error({ err }, "write failed");
      });
      c().catch(handleWriteFailure);
      d().catch(async (err) => { await report(err); });
      e().catch(() => null);
    `;
    assert.deepEqual(swallowingCatches(logging), []);
  });

  test("the scan actually reaches server/socket.ts's catch handlers", () => {
    const src = readFileSync(SOCKET_SOURCE, "utf8");
    const catches = [...src.matchAll(/\.catch\s*\(/g)].length;
    assert.ok(catches > 8, `expected many catch handlers in server/socket.ts, found ${catches}`);
  });
});
