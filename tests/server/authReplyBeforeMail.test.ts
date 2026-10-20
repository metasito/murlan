// tests/server/authReplyBeforeMail.test.ts — #897: the enumeration-safe handlers'
// whole guarantee is that the reply goes out before the extra work a "real"
// account does — a token mint (an INSERT) or a mail send — so a prober
// cannot time the two branches apart. tests/integration/passwordReset.test.ts
// keeps a timing smoke test, but timing is noise-bound on CI; this is the
// deterministic guarantee it stands in front of. Source position, not
// runtime behaviour: prove it red by swapping the lines back (design doc,
// #897 checklist item 5).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { routeCalls, routeSources } from "../helpers/routeSources.ts";

const areaFiles = routeSources().map((s) => s.sourceFile);

/** The handler function mounted under `route` in any of `files`. */
function routeHandler(route: string, files: ts.SourceFile[]): ts.Node {
  const handler = files.flatMap(routeCalls).find((c) => c.route === route)?.handler;
  if (!handler) throw new Error(`no on(app, "${route}", ...) mounting found`);
  return handler;
}

const synthetic = (source: string) => [
  ts.createSourceFile("synthetic.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
];

/** Every call `callee(...)` reachable inside `node`, by the callee's own shape. */
function callsMatching(node: ts.Node, isTarget: (callee: ts.Expression) => boolean): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && isTarget(n.expression)) calls.push(n);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return calls;
}

/**
 * Whether `n` is a brace-less `if`/loop body — `if (x) res.json(...)` has no
 * `{ ... }` for the block check below to stop at, so without this a reply
 * guarded by an untaken condition would count as covering a sibling
 * statement the same way a guaranteed one does.
 */
function isConditionalSingleStatement(n: ts.Node): boolean {
  const p = n.parent;
  if (!p) return false;
  if (ts.isIfStatement(p) && (p.thenStatement === n || p.elseStatement === n)) return true;
  if (
    (ts.isWhileStatement(p) || ts.isDoStatement(p) || ts.isForStatement(p) || ts.isForInStatement(p) || ts.isForOfStatement(p)) &&
    p.statement === n
  ) {
    return true;
  }
  return false;
}

/**
 * The same search as `callsMatching`, except it does not descend into a
 * nested `{ ... }` block — an if/else/try body or a callback's own body is a
 * different, not-necessarily-shared execution path, and a reply inside one
 * of those (an early-return guard, most often) must not count as covering a
 * sibling statement that runs on a different path. A brace-less `if`/loop
 * body is the same wall without the braces.
 */
function callsMatchingSamePath(node: ts.Node, isTarget: (callee: ts.Expression) => boolean): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (n !== node && (ts.isBlock(n) || isConditionalSingleStatement(n))) return;
    if (ts.isCallExpression(n) && isTarget(n.expression)) calls.push(n);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return calls;
}

const isResJson = (callee: ts.Expression) =>
  ts.isPropertyAccessExpression(callee) && callee.name.text === "json";

const isCallNamed = (names: Set<string>) => (callee: ts.Expression) =>
  ts.isIdentifier(callee) && names.has(callee.text);

/**
 * Whether a reply (`res.json`/`res.status(...).json`) occurs before `mail`
 * on every path that can reach it — checked one block at a time rather than
 * as one flat "every reply anywhere before every mail call anywhere"
 * comparison, because two mutually exclusive branches (an early-return
 * refusal, and the success path) each reply before their own send, but the
 * refusal's reply sits earlier in the file than the success path's — a flat
 * comparison would fault a branch for a sibling branch's ordering.
 *
 * Walks from `mail` up through its enclosing blocks. At each level, a reply
 * anywhere in an earlier-or-same statement of that block (searched
 * recursively, so a reply nested inside an earlier callback still counts)
 * satisfies it; otherwise the search continues in the block enclosing that
 * one, up to the handler's own root.
 */
function replyPrecedes(mail: ts.CallExpression, root: ts.Node): boolean {
  let cursor: ts.Node = mail;
  for (;;) {
    let block: ts.Node | undefined = cursor.parent;
    while (block && !ts.isBlock(block) && block !== root) block = block.parent;
    if (!block || (block !== root && !ts.isBlock(block))) return false;

    const statements = ts.isBlock(block) ? block.statements : undefined;
    if (statements) {
      let ownIndex = -1;
      for (let n: ts.Node = cursor; n !== block; n = n.parent!) {
        const i = statements.indexOf(n as ts.Statement);
        if (i !== -1) {
          ownIndex = i;
          break;
        }
      }
      if (ownIndex === -1) return false;
      for (let i = 0; i <= ownIndex; i++) {
        if (
          callsMatchingSamePath(statements[i], isResJson).some(
            (c) => c.getStart() < mail.getStart()
          )
        ) {
          return true;
        }
      }
    }
    if (block === root) return false;
    cursor = block;
  }
}

function assertReplyBeforeMail(routeLiteral: string, mailCallNames: Set<string>) {
  const handler = routeHandler(routeLiteral, areaFiles);
  const replies = callsMatching(handler, isResJson);
  const mailCalls = callsMatching(handler, isCallNamed(mailCallNames));

  assert.ok(replies.length > 0, `${routeLiteral}: found no res.json call — the scan is not reaching the handler`);
  assert.ok(
    mailCalls.length > 0,
    `${routeLiteral}: found none of [${[...mailCallNames].join(", ")}] — the scan is not reaching the handler`
  );

  for (const mail of mailCalls) {
    assert.ok(
      replyPrecedes(mail, handler),
      `${routeLiteral}: a mail-reaching call at offset ${mail.getStart()} has no reply before it ` +
        `on its own path — the response must go out before any token mint or send`
    );
  }
}

describe("a reply goes out before any token mint or mail send on its own path (#897)", () => {
  test("request-password-reset", () => {
    assertReplyBeforeMail(
      "POST /api/auth/request-password-reset",
      new Set(["mintAuthToken", "sendPasswordResetEmail"])
    );
  });

  test("register", () => {
    assertReplyBeforeMail(
      "POST /api/auth/register",
      new Set(["replaceEmailVerifyCode", "sendVerificationEmail"])
    );
  });

  test("proved red by swapping the lines back", () => {
    const reversed = `
      on(app, "POST /api/x", async (req, res) => {
        const token = await mintAuthToken(user.id, "email_verify", TTL);
        res.json({ ok: true });
      });
    `;
    const handler = routeHandler("POST /api/x", synthetic(reversed));
    const [mail] = callsMatching(handler, isCallNamed(new Set(["mintAuthToken"])));
    assert.ok(mail, "fixture setup: expected a mintAuthToken call");
    assert.equal(
      replyPrecedes(mail, handler),
      false,
      "the same check the tests above run must fail on this fixture"
    );
  });

  test("a reply in an earlier sibling branch does not excuse a later branch's own ordering", () => {
    // The exact shape that broke a flatter "every reply anywhere precedes
    // every mail call anywhere" version of this check: an early-return
    // refusal's reply sits earlier in the file than the success path's, but
    // that must not let the success path skip having its own.
    const broken = `
      on(app, "POST /api/x", async (req, res) => {
        if (taken) {
          res.json({ ok: true });
          return;
        }
        const token = await mintAuthToken(user.id, "email_verify", TTL);
        res.json({ ok: true });
      });
    `;
    const handler = routeHandler("POST /api/x", synthetic(broken));
    const [mail] = callsMatching(handler, isCallNamed(new Set(["mintAuthToken"])));
    assert.ok(mail);
    assert.equal(replyPrecedes(mail, handler), false, "the success branch's own reply must still be required");
  });

  test("a reply inside a brace-less if does not excuse an unconditional mail call (#894 review, test weakness 4)", () => {
    // Same shape as the block-bodied version above, minus the braces: a
    // reply that only fires on `taken` must not be read as covering the
    // mail call below it, which runs unconditionally.
    const broken = `
      on(app, "POST /api/x", async (req, res) => {
        if (taken) res.json({ ok: true });
        const token = await mintAuthToken(user.id, "email_verify", TTL);
      });
    `;
    const handler = routeHandler("POST /api/x", synthetic(broken));
    const [mail] = callsMatching(handler, isCallNamed(new Set(["mintAuthToken"])));
    assert.ok(mail);
    assert.equal(replyPrecedes(mail, handler), false, "a conditional reply must not excuse an unconditional mail call");
  });
});
