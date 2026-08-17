// tests/socketErrorLogging.test.ts — a bookkeeping write in server/socket.ts is
// fire-and-forget on purpose: it must never block or fail a hand. That shape is
// one character away from invisible, though. `.catch(() => {})` on
// `removeRoomPlayer` leaves the room_players row alive while the in-memory seat
// is vacated, and claimRoomSeat counts rows: the room reports itself full to the
// next joiner until the 24h sweeper reaches it, with nothing in the log to say
// why.
//
// This pins the half TypeScript cannot see — a `.catch()` whose handler is
// written inline and does nothing with the error. The check is on the shape of
// the handler rather than any literal spelling, so whitespace, `async`, a
// `function` expression and any parameter list are all covered. A handler
// passed by name is out of scope: the body is not at the call site.
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

/** Index of the closer matching the `open`/`close` pair opened at `from`, or -1. */
function matchPair(src: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return i;
  }
  return -1;
}

/** Consumes a parameter list at `i`, returning the index after `)`, or -1. */
function skipParams(src: string, i: number): number {
  const close = matchPair(src, i, "(", ")");
  return close === -1 ? -1 : skipWs(src, close + 1);
}

/**
 * 1-based line numbers of every `.catch(` in `src` whose inline handler has an
 * empty or comment-only block body — arrow or `function` expression, with any
 * parameter list including defaults and destructuring.
 *
 * An expression-bodied arrow is left alone: `.catch(() => null)` supplies a
 * fallback the caller then acts on, which is a different thing from discarding
 * the error. A handler passed by name is out of reach here and is skipped: the
 * function it names is not at this call site.
 */
function swallowingCatches(src: string): number[] {
  const found: number[] = [];
  for (const m of src.matchAll(/\.catch\s*\(/g)) {
    const start = m.index;
    let i = skipWs(src, start + m[0].length);
    if (src.startsWith("async", i)) i = skipWs(src, i + "async".length);

    if (src.startsWith("function", i)) {
      i = skipWs(src, i + "function".length);
      const name = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      if (name) i = skipWs(src, i + name[0].length);
      if (src[i] !== "(") continue;
      i = skipParams(src, i);
      if (i === -1) continue;
    } else {
      if (src[i] === "(") {
        i = skipParams(src, i);
        if (i === -1) continue;
      } else {
        const ident = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
        if (!ident) continue;
        i = skipWs(src, i + ident[0].length);
      }
      if (!src.startsWith("=>", i)) continue;
      i = skipWs(src, i + 2);
    }

    if (src[i] !== "{") continue;
    const end = matchPair(src, i, "{", "}");
    if (end === -1) continue;

    if (stripComments(src.slice(i + 1, end)).trim() === "") {
      found.push(src.slice(0, start).split("\n").length);
    }
  }
  return found;
}

describe("server/socket.ts logs the bookkeeping writes that fail", () => {
  test("no inline promise catch discards its error", () => {
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
      f().catch(function (err) {});
      g().catch(async function onFail(err) {});
      h().catch((err = new Error("x")) => {});
      i().catch(({ message }) => {});
    `;
    assert.deepEqual(
      swallowingCatches(swallowing).length,
      9,
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
      f().catch(function (err) { logger.error({ err }, "write failed"); });
    `;
    assert.deepEqual(swallowingCatches(logging), []);
  });

  test("the scan actually reaches server/socket.ts's catch handlers", () => {
    const src = readFileSync(SOCKET_SOURCE, "utf8");
    const catches = [...src.matchAll(/\.catch\s*\(/g)].length;
    assert.ok(catches > 8, `expected many catch handlers in server/socket.ts, found ${catches}`);
  });
});
