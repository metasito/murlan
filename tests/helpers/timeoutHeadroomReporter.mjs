// A node:test reporter failing the run when a test that passed spent over its share of its own time
// limit (tests/helpers/timeoutHeadroom.mjs): its `timeout` option, else the run's --test-timeout. A
// suite has a limit only when it names one; node gives it none from --test-timeout.
import { readFileSync } from "node:fs";
import path from "node:path";
import { HEADROOM_SHARE, headroomMessage, overHeadroom } from "./timeoutHeadroom.mjs";

const UNREADABLE = "unreadable";

/** @param {string[]} execArgv */
export function runTimeoutMs(execArgv = process.execArgv) {
  let ms = Infinity;
  execArgv.forEach((arg, i) => {
    if (arg.startsWith("--test-timeout=")) ms = Number(arg.slice("--test-timeout=".length));
    else if (arg === "--test-timeout") ms = Number(execArgv[i + 1]);
  });
  return ms;
}

/**
 * Each `test`/`it`/`describe`/`suite` call's own `timeout` option, keyed `line:column` of the call's
 * name as node reports it, `"unreadable"` where it is not a number literal.
 * @param {string} source
 * @param {string} fileName
 * @param {typeof import("typescript")} ts
 * @returns {Map<string, number | typeof UNREADABLE>}
 */
export function declaredTimeouts(source, fileName, ts) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  /** @type {Map<string, number | typeof UNREADABLE>} */
  const found = new Map();
  const visit = (/** @type {import("typescript").Node} */ node) => {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression : ts.isPropertyAccessExpression(node.expression) ? node.expression.name : undefined;
      const options = node.arguments.find(ts.isObjectLiteralExpression);
      const timeout = options?.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "timeout");
      if (name && timeout) {
        const { line, character } = file.getLineAndCharacterOfPosition(name.getStart(file));
        const value = ts.isPropertyAssignment(timeout) && ts.isNumericLiteral(timeout.initializer) ? Number(timeout.initializer.text) : UNREADABLE;
        found.set(`${line + 1}:${character + 1}`, value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * @param {{ type: string, data: any }[] | AsyncIterable<{ type: string, data: any }>} source
 * @param {{ runTimeout?: number, read?: (file: string) => string }} [options]
 */
export default async function* timeoutHeadroom(source, { runTimeout = runTimeoutMs(), read = (file) => readFileSync(file, "utf8") } = {}) {
  /** @type {typeof import("typescript") | undefined} */
  let ts;
  /** @type {Map<string, Map<string, number | typeof UNREADABLE>>} */
  const declared = new Map();
  const limitOf = async (/** @type {any} */ data) => {
    if (!declared.has(data.file)) {
      const text = read(data.file);
      if (!/\btimeout\s*:/.test(text)) declared.set(data.file, new Map());
      else {
        ts ??= (await import("typescript")).default;
        declared.set(data.file, declaredTimeouts(text, data.file, ts));
      }
    }
    return declared.get(data.file)?.get(`${data.line}:${data.column}`) ?? (data.details.type === "suite" ? Infinity : runTimeout);
  };
  const over = [];
  /** @type {{ share: number, line: string }[]} */
  const judged = [];
  let passed = 0;
  for await (const { type, data } of source) {
    if (type !== "test:pass" || data.skip || data.todo || !data.file || data.line === undefined) continue;
    if (data.details.type !== "suite") passed++;
    const limit = await limitOf(data);
    const where = `${path.relative(process.cwd(), data.file).split(path.sep).join("/")}:${data.line} "${data.name}"`;
    if (limit === UNREADABLE) {
      over.push(`${where}: its timeout is not a number literal, so ${HEADROOM_SHARE * 100}% of it cannot be judged`);
      continue;
    }
    if (!Number.isFinite(limit)) continue;
    const spent = data.details.duration_ms;
    judged.push({ share: spent / limit, line: `${Math.round((spent / limit) * 100)}% ${where}` });
    if (overHeadroom(spent, limit)) over.push(`${where}: ${headroomMessage(data.details.type === "suite" ? "This suite" : "This test", spent, limit)}`);
  }
  if (passed > 0 && judged.length === 0) over.push(`${passed} tests passed and none was judged: the run sets no --test-timeout`);
  const closest = judged.sort((a, b) => b.share - a.share).slice(0, 10);
  if (closest.length > 0) yield `\nTimeout headroom, the ${closest.length} tests closest to their limits:\n${closest.map((j) => `  ${j.line}`).join("\n")}\n`;
  for (const line of over) yield `timeout headroom: ${line}\n`;
  if (over.length > 0) process.exitCode = 1;
}
