// A node:test reporter warning, as a CI annotation, when a test that passed spent over its share of its
// own time limit (tests/helpers/timeoutHeadroom.mjs). It fails the run only when it cannot judge: a
// timeout it cannot compute, or a run with no limit at all. A test's limit is its `timeout` option,
// else the run's --test-timeout. A suite has a limit only when it names one; node gives it none from
// --test-timeout. A file's limit is tests/helpers/fileDeadline.mjs's, when the run imports it: the only
// one a test that blocks its event loop answers to.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deadlineMs } from "./fileDeadline.mjs";
import { HEADROOM_SHARE, headroomMessage, overHeadroom } from "./timeoutHeadroom.mjs";

const UNREADABLE = "unreadable";
const FILE_DEADLINE = fileURLToPath(new URL("./fileDeadline.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * @param {string[]} execArgv
 * @param {string} flag
 */
const values = (execArgv, flag) =>
  execArgv.flatMap((arg, i) => (arg.startsWith(`${flag}=`) ? [arg.slice(flag.length + 1)] : arg === flag && i + 1 < execArgv.length ? [execArgv[i + 1]] : []));

/** @param {string[]} execArgv */
export function runTimeoutMs(execArgv = process.execArgv) {
  const set = values(execArgv, "--test-timeout").at(-1);
  return set === undefined ? Infinity : Number(set);
}

/**
 * @param {string[]} execArgv
 * @param {Record<string, string | undefined>} env
 */
export function fileLimitMs(execArgv = process.execArgv, env = process.env) {
  return values(execArgv, "--import").some((m) => path.resolve(m) === FILE_DEADLINE) ? deadlineMs(env) : Infinity;
}

/**
 * A `timeout` that is not a number literal, as the file's own top level computes it: the imports and
 * top-level constants it names, run in a child so their side effects stay out of this run. Undefined
 * when it names anything else.
 * @param {import("typescript").Expression} expression
 * @param {import("typescript").SourceFile} file
 * @param {typeof import("typescript")} ts
 */
export function evaluateTimeout(expression, file, ts) {
  /** @type {Map<string, import("typescript").Statement>} */
  const topLevel = new Map();
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      for (const id of [clause?.name, ...(bindings && ts.isNamedImports(bindings) ? bindings.elements.map((e) => e.name) : [bindings?.name])]) {
        if (id) topLevel.set(id.text, statement);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) if (ts.isIdentifier(d.name)) topLevel.set(d.name.text, statement);
    }
  }
  const needed = new Set();
  /** @param {import("typescript").Node} node */
  const named = (node) => {
    if (ts.isIdentifier(node)) {
      const statement = topLevel.get(node.text);
      if (!statement) return node.text in globalThis;
      if (needed.has(statement)) return true;
      needed.add(statement);
      return ts.isImportDeclaration(statement) || statement.declarationList.declarations.every((d) => !d.initializer || named(d.initializer));
    }
    if (ts.isPropertyAccessExpression(node)) return named(node.expression);
    let ok = true;
    ts.forEachChild(node, (child) => void (ok &&= named(child)));
    return ok;
  };
  if (!named(expression)) return undefined;
  const lines = file.statements
    .filter((s) => needed.has(s))
    .map((s) => {
      const text = s.getText(file);
      if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.moduleSpecifier.text.startsWith(".")) return text;
      const absolute = new URL(s.moduleSpecifier.text, pathToFileURL(file.fileName)).href;
      return text.replace(s.moduleSpecifier.getText(file), JSON.stringify(absolute));
    });
  const script = `${lines.join("\n")}\nprocess.stdout.write(JSON.stringify(${expression.getText(file)}));\nprocess.exit(0);\n`;
  const run = spawnSync(process.execPath, ["--no-warnings", "--input-type=module-typescript", "-e", script], { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 });
  const value = run.status === 0 ? Number(run.stdout) : NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Each `test`/`it`/`describe`/`suite` call's own `timeout` option, keyed `line:column` of the call's
 * name as node reports it, `"unreadable"` where `evaluateTimeout` cannot compute it.
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
        const initializer = ts.isPropertyAssignment(timeout) ? timeout.initializer : undefined;
        const value = !initializer ? undefined : ts.isNumericLiteral(initializer) ? Number(initializer.text) : evaluateTimeout(initializer, file, ts);
        found.set(`${line + 1}:${character + 1}`, value ?? UNREADABLE);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** @param {any} data */
const isFile = (data) => data?.nesting === 0 && path.resolve(data.name ?? "") === path.resolve(data.file ?? "");
/** @param {string} file */
const relative = (file) => path.relative(REPO_ROOT, file).split(path.sep).join("/");

/**
 * @param {Iterable<{ type: string, data: any }> | AsyncIterable<{ type: string, data: any }>} source
 * @param {{ runTimeout?: number, fileLimit?: number, read?: (file: string) => string }} [options]
 */
export default async function* timeoutHeadroom(source, { runTimeout = runTimeoutMs(), fileLimit = fileLimitMs(), read = (file) => readFileSync(file, "utf8") } = {}) {
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
  /** @type {string[]} */
  const broken = [];
  /** @type {{ share: number, line: string }[]} */
  const judged = [];
  let passed = 0;
  const judge = (/** @type {string} */ where, /** @type {string} */ what, /** @type {number} */ spent, /** @type {number} */ limit) => {
    if (!Number.isFinite(limit)) return;
    judged.push({ share: spent / limit, line: `${Math.round((spent / limit) * 100)}% of ${limit / 1000} s ${where}` });
    if (overHeadroom(spent, limit)) over.push(`${where}: ${headroomMessage(what, spent, limit)}`);
  };
  for await (const { type, data } of source) {
    if (type === "test:complete" && isFile(data) && data.details?.passed) judge(relative(data.file), "This file", data.details.duration_ms, fileLimit);
    if (type !== "test:pass" || data.skip || data.todo || !data.file || data.line === undefined) continue;
    if (data.details.type !== "suite") passed++;
    const limit = await limitOf(data);
    const where = `${relative(data.file)}:${data.line} "${data.name}"`;
    if (limit === UNREADABLE) broken.push(`${where}: its timeout is not computed from the file's imports and top-level constants alone, so ${HEADROOM_SHARE * 100}% of it cannot be judged`);
    else judge(where, data.details.type === "suite" ? "This suite" : "This test", data.details.duration_ms, limit);
  }
  if (passed > 0 && judged.length === 0) broken.push(`${passed} tests passed and none was judged: the run sets no --test-timeout`);
  const near = judged.filter((j) => j.share > HEADROOM_SHARE / 2).sort((a, b) => b.share - a.share);
  yield (
    `\nTimeout headroom: ${judged.length} tests and files judged, ${near.length} past half of the ${HEADROOM_SHARE * 100}% of its limit one may spend${near.length > 0 ? ":" : "."}\n` +
    near.map((j) => `  ${j.line}\n`).join("") +
    over.map((line) => `::warning::timeout headroom: ${line}\n`).join("") +
    broken.map((line) => `timeout headroom: ${line}\n`).join("")
  );
  if (broken.length > 0) process.exitCode = 1;
}
