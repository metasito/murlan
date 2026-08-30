/**
 * Who reads each field of the two game contexts.
 *
 * The argument for splitting these is a count — how wide the surface is and
 * how many of its fields have exactly one reader — and a count asserted from
 * memory goes stale. This derives it, so the seam plan is measured rather than
 * recalled.
 *
 * A field is "read" where a file destructures it off the hook, or reads it as a
 * property of a value taken from the hook. Matching the bare identifier
 * anywhere in a file that mentions the hook instead counts `error`, `pass` and
 * `room` in every file that has its own, which inflates every field to many
 * readers and makes the "one consumer" question unanswerable.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".git", "dist", ".expo", ".worktrees"]);

export function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * The field names of an `interface X { … }` block, comments and nesting
 * ignored.
 *
 * Comments go first, and have to: the nesting depth is counted from braces and
 * parentheses, so one unbalanced `{` or `(` in a doc comment leaves the walk
 * permanently inside a nested type and every field below it is dropped. A
 * caller checking that some set covers this one would then be told it does,
 * over a list that stops early.
 */
export function fieldsOf(source, interfaceName) {
  source = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const start = source.indexOf(`interface ${interfaceName}`);
  if (start === -1) throw new Error(`no interface ${interfaceName}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(open + 1, end);
  const fields = [];
  let depthNow = 0;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    const m = depthNow === 0 && trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\??:/);
    if (m) fields.push(m[1]);
    depthNow += (line.match(/[{(]/g) ?? []).length - (line.match(/[})]/g) ?? []).length;
  }
  return fields;
}

/**
 * The names a file actually takes off the hook.
 *
 * Destructuring sites only. Matching a bare identifier anywhere in a file that
 * mentions the hook counts `error`, `pass` and `room` in every file that has
 * its own, which inflates every field to many readers and makes the "one
 * consumer" question unanswerable.
 */
export function destructuredNames(source, hookName) {
  const names = new Set();
  // Anchored on `const {`, not a bare brace. A destructure that is the first
  // statement inside a function has no `}` between the function's own opening
  // brace and its closing one, so a bare-brace match starts at the function
  // and swallows the first name into `const {  <name>`.
  const re = new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*${hookName}\\s*\\(`, "g");
  for (const m of source.matchAll(re)) {
    for (const part of m[1].split(",")) {
      const name = part.split(":")[0].trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) names.add(name);
    }
  }
  // `const ctx = useOnlineGame()` then `ctx.field` reads the same way.
  for (const m of source.matchAll(
    new RegExp(`(?:const|let)\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*${hookName}\\s*\\(`, "g")
  )) {
    for (const hit of source.matchAll(new RegExp(`\\b${m[1]}\\.([A-Za-z_][A-Za-z0-9_]*)`, "g"))) {
      names.add(hit[1]);
    }
  }
  return names;
}

export function readersOf(fields, files, hookName) {
  const readers = new Map(fields.map((f) => [f, []]));
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!src.includes(hookName)) continue;
    const taken = destructuredNames(src, hookName);
    for (const field of fields) {
      if (taken.has(field)) readers.get(field).push(path.relative(ROOT, file));
    }
  }
  return readers;
}

if (import.meta.filename === process.argv[1]) {
  const files = walk(ROOT).filter((f) => !/[\\/]context[\\/](Online)?GameContext\.tsx$/.test(f));
  for (const [file, iface, hook] of [
    ["context/OnlineGameContext.tsx", "OnlineGameContextValue", "useOnlineGame"],
    ["context/GameContext.tsx", "GameContextValue", "useGame"],
  ]) {
    const fields = fieldsOf(readFileSync(path.join(ROOT, file), "utf8"), iface);
    const readers = readersOf(fields, files, hook);
    const single = [...readers].filter(([, r]) => r.length === 1);
    const none = [...readers].filter(([, r]) => r.length === 0);
    console.log(`\n=== ${iface}: ${fields.length} fields ===`);
    console.log(`  no reader outside the provider: ${none.length}  ${none.map(([f]) => f).join(", ")}`);
    console.log(`  exactly one reader: ${single.length}`);
    const byFile = new Map();
    for (const [f, r] of single) {
      byFile.set(r[0], [...(byFile.get(r[0]) ?? []), f]);
    }
    for (const [f, names] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`    ${f}  (${names.length})  ${names.join(", ")}`);
    }
  }
}
