// Finds every fixed real-time wait in a set of sources: the scan behind the browser suite's
// e2eFixedSleeps and the server suites' integrationSleepInventory.
import { blankComments } from "./sourceScan.ts";

const MARKER = /fixed wait on purpose:\s*\S+\s+\S+\s+\S+/;

export type Site = { file: string; line: number; justified: boolean };

/** A promise resolved by a timer: arrow or function executor, the resolver passed or called. */
const PROMISE_SLEEP = String.raw`new\s+Promise\s*(?:<[^>]*>)?\s*\(\s*(?:async\s+)?(?:function\s*)?\(?\s*(\w+)\s*(?::[^),]*)?\)?\s*(?:=>)?\s*\{?\s*(?:return\s+)?(?:window\.|globalThis\.)?setTimeout\s*\(\s*(?:\1\b|\(\)\s*=>\s*\1\(|function\s*\(\)\s*\{\s*\1\()`;

const sleepCall = (names: string[]) =>
  new RegExp(
    [String.raw`(?:\.waitForTimeout|\[\s*["'\x60]waitForTimeout["'\x60]\s*\])\s*\(`, PROMISE_SLEEP, ...names.map((n) => String.raw`(?<![\w.$]|function\s+)${n}\s*\(`)].join("|"),
    "g"
  );

/** Declarations whose whole body is one sleep, as `[name, body start, body end]`. */
function wrappers(code: string, known: string[]): [string, number, number][] {
  const found: [string, number, number][] = [];
  const header = /(?:function\s+(\w+)\s*\([^)]*\)[^{;]*\{|(?:const|let)\s+(\w+)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]*)?=>\s*)/g;
  for (const m of code.matchAll(header)) {
    const start = m.index + m[0].length;
    let end = start;
    if (m[0].endsWith("{") || code[start] === "{") {
      let depth = 0;
      for (end = m[0].endsWith("{") ? start - 1 : start; end < code.length; end++) {
        if (code[end] === "{") depth++;
        else if (code[end] === "}" && --depth === 0) break;
      }
    } else end = code.indexOf("\n", start) === -1 ? code.length : code.indexOf("\n", start);
    const body = code.slice(start, end).replace(/^\s*\{/, "").trim();
    const call = sleepCall(known.filter((n) => n !== (m[1] ?? m[2]))).exec(body.replace(/^(?:return|await)\s+/, ""));
    if (call?.index === 0 && !/;\s*\S/.test(body.replace(/;?\s*$/, ""))) found.push([(m[1] ?? m[2])!, start, end]);
  }
  return found;
}

/**
 * Names that sleep when called, per file: wrappers of a sleep (to any depth), `timers/promises`, a
 * promisified timer. A wrapper reaches another file only through an import of its name, so two
 * files' unrelated helpers that share a name are not mistaken for each other.
 */
function sleepers(files: Map<string, string>): Map<string, Set<string>> {
  const names = new Map<string, Set<string>>();
  for (const [file, code] of files) {
    const own = new Set<string>();
    for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?timers\/promises["']/g)) {
      for (const spec of m[1]!.split(",")) {
        const [imported, local] = spec.trim().split(/\s+as\s+/);
        if (imported === "setTimeout") own.add(local ?? imported);
      }
    }
    for (const m of code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:\w+\.)?promisify\(\s*setTimeout\s*\)/g)) own.add(m[1]!);
    names.set(file, own);
  }
  const imported = (code: string, name: string) =>
    new RegExp(String.raw`import\s*(?:type\s*)?\{[^}]*\b${name}\b[^}]*\}\s*from`).test(code);
  for (let grew = true; grew; ) {
    grew = false;
    const everywhere = new Set([...names.values()].flatMap((own) => [...own]));
    for (const [file, code] of files) {
      const own = names.get(file)!;
      const before = own.size;
      for (const name of everywhere) if (!own.has(name) && imported(code, name)) own.add(name);
      for (const [name] of wrappers(code, [...own])) own.add(name);
      if (own.size !== before) grew = true;
    }
  }
  return names;
}

/** Every fixed real-time wait in `files`, as `[repo-relative path, source]`. */
export function fixedSleeps(files: [string, string][]): Site[] {
  const code = new Map(files.map(([f, src]) => [f, blankComments(src)]));
  const known = sleepers(code);
  const sites: Site[] = [];
  for (const [file, src] of files) {
    const text = code.get(file)!;
    const names = [...known.get(file)!];
    const lines = src.split("\n");
    const bodies = wrappers(text, names).map(([, start, end]) => [start, end]);
    const hits = [...text.matchAll(sleepCall(names))]
      .map((m) => m.index)
      .filter((i) => !bodies.some(([start, end]) => i >= start! && i < end!));
    for (const index of hits) {
      const line = text.slice(0, index).split("\n").length;
      const justified = MARKER.test(lines[line - 1] ?? "") || MARKER.test(lines[line - 2] ?? "");
      sites.push({ file, line, justified });
    }
  }
  return sites;
}
