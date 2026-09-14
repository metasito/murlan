import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** What `scannedFiles` walks: the two trees that hold rendered UI, never one without the other. */
const SCANNED_DIRS = ["components", "app"];

/** The sources under `dirs`, as `[repo-relative path, contents]`. */
export function sourcesUnder(repoRoot: string, dirs: string[], keep = /\.tsx?$/): [string, string][] {
  return dirs.flatMap((dir) =>
    readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
      // match, not test: a caller's `/g` pattern would carry lastIndex from one
      // file to the next and drop every other one.
      .filter((f) => f.match(keep))
      .map((f): [string, string] => [
        path.posix.join(dir, f.split(path.sep).join("/")),
        readFileSync(path.join(repoRoot, dir, f), "utf8"),
      ])
  );
}

/** `app/`, `components/` and `lib/`, as `[repo-relative path, contents]`. */
export function clientSources(repoRoot: string): [string, string][] {
  return sourcesUnder(repoRoot, ["app", "components", "lib"]);
}

/** `components/` alone — for a rule about what draws, rather than about the client. */
export function componentSources(repoRoot: string): [string, string][] {
  return sourcesUnder(repoRoot, ["components"]);
}

/** Every match of `pattern`, as `path: match`, sorted, so a failure names where it found it. */
export function scanSources(pattern: RegExp, sources: [string, string][]): string[] {
  const hits: string[] = [];
  for (const [file, src] of sources) {
    for (const m of src.matchAll(pattern)) hits.push(`${file}: ${m[0]}`);
  }
  return hits.sort();
}

/** Every `.tsx` under the scanned trees, as a repo-relative path with `/` separators. */
export function scannedFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".tsx")) out.push(rel);
    }
  };
  SCANNED_DIRS.forEach(walk);
  return out;
}

/**
 * What may sit immediately before a `/` that opens a regex literal. `}` and
 * `<` are left out on purpose: both are how JSX writes `{…} />` and `</Tag>`,
 * and reading either as a regex swallows the rest of the file.
 *
 * Read against the source, never against the buffer being blanked: a blanked
 * `a="b"` ends in `=`, which would make the two modes tokenise differently.
 */
const OPENS_REGEX =
  /(?:[(,=:[!&|?;+\-*%^~{]|=>|\b(?:return|typeof|instanceof|in|of|case|new|delete|void|throw|do|else|yield|await))\s*$/;

/** Where the walker opened something the input never closed. */
type Unclosed = { kind: "block comment" | "template literal" | "string literal"; at: number };

/**
 * One left-to-right pass: whichever of a comment, a string, a template or a
 * regex literal opens first owns the span up to its own closer, so a quote
 * inside a string is content rather than an opener.
 *
 * Blanking, not removing: every offset in the result still points at the line
 * it came from, so a scan can report where it found something.
 *
 * A source scan that reads comments as code fails on prose — a comment naming
 * `<Modal>` is not a modal, and the report is a red run with nothing to fix.
 */
function blankSpans(source: string, blankStrings: boolean): string {
  // split(""), not [...source]: the spread yields code points, so blanking an
  // astral character would replace two UTF-16 units with one space and shift
  // every offset after it.
  const out = source.split("");
  const unclosed: Unclosed[] = [];
  const ranOff = (kind: Unclosed["kind"], at: number) => {
    unclosed.push({ kind, at });
  };
  const erase = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };

  // A `'…'` or `"…"` cannot cross a line break it has not escaped, so an
  // apostrophe in prose ends at the newline rather than running on through the
  // code below it.
  const quoted = (start: number): number => {
    let i = start + 1;
    while (i < source.length && source[i] !== source[start] && source[i] !== "\n") {
      i += source[i] === "\\" ? 2 : 1;
    }
    if (i >= source.length) ranOff("string literal", start);
    const end = Math.min(i + 1, source.length);
    if (blankStrings) erase(start, end);
    return end;
  };

  const regexLiteral = (start: number): number => {
    let i = start + 1;
    let inClass = false;
    while (i < source.length && source[i] !== "\n") {
      const c = source[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) return i + 1;
      i++;
    }
    return start + 1; // unterminated: it was a division after all
  };

  const template = (start: number): number => {
    if (blankStrings) erase(start, start + 1);
    let i = start + 1;
    while (i < source.length) {
      const c = source[i];
      if (c === "\\") {
        if (blankStrings) erase(i, i + 2);
        i += 2;
      } else if (c === "`") {
        if (blankStrings) erase(i, i + 1);
        return i + 1;
      } else if (c === "$" && source[i + 1] === "{") {
        i = walk(i + 2, true); // the interpolation holds code, not literal text
      } else {
        if (blankStrings) erase(i, i + 1);
        i++;
      }
    }
    ranOff("template literal", start);
    return i;
  };

  /** From `from` to end of input, or just past the `}` closing an interpolation. */
  function walk(from: number, untilBrace: boolean): number {
    let i = from;
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      const two = c + source[i + 1];
      if (two === "/*") {
        const close = source.indexOf("*/", i + 2);
        const end = close < 0 ? source.length : close + 2;
        if (close < 0) ranOff("block comment", i);
        erase(i, end);
        i = end;
      } else if (two === "//" && source[i - 1] !== ":") {
        const nl = source.indexOf("\n", i);
        const end = nl < 0 ? source.length : nl;
        erase(i, end);
        i = end;
      } else if (c === '"' || c === "'") {
        i = quoted(i);
      } else if (c === "`") {
        i = template(i);
      } else if (c === "/" && OPENS_REGEX.test(source.slice(Math.max(0, i - 16), i))) {
        i = regexLiteral(i);
      } else {
        if (untilBrace && c === "{") depth++;
        else if (untilBrace && c === "}") {
          if (depth === 0) return i + 1;
          depth--;
        }
        i++;
      }
    }
    return i;
  }

  walk(0, false);
  // The earliest opener, not the first reported: an unterminated construct
  // nested inside another runs off the end before the one that swallowed it,
  // and where the erasure begins is what names the file's defect.
  const [first] = unclosed.sort((a, b) => a.at - b.at);
  if (first) throw unclosedError(source, first.kind, first.at);
  return out.join("");
}

/**
 * A construct opened and never closed is the one unambiguous sign that the
 * blanking erased the file rather than subtracted from it: a share of what
 * survived cannot tell the two apart, since the honest low is below the
 * runaway's. It throws rather than returning a flag, so that every scan built
 * on these helpers has the floor whether or not it asked for one.
 */
function unclosedError(source: string, kind: Unclosed["kind"], at: number): Error {
  const line = source.slice(0, at).split("\n").length;
  const text = source.slice(at).split("\n")[0].trim().slice(0, 60);
  return new Error(
    `unterminated ${kind} at line ${line} (${text}) — the blanking erased the rest of the file, ` +
      `so a scan of it reads clean by not reading it. Close it, or the scan is blind.`
  );
}

/** `//` and block comments. A `//` behind a `:` is a URL's, not a comment's. */
export function blankComments(source: string): string {
  return blankSpans(source, false);
}

/**
 * Comments and every string literal. Use this only when the scan is looking
 * for code: a scan reading JSX attribute values needs the strings kept.
 *
 * Nothing here reads JSX, so an apostrophe in prose — `<Text>don't</Text>` —
 * opens a literal that takes the rest of that line. The line break bounds it,
 * and `blankComments` does not have the defect at all.
 */
export function blankCommentsAndStrings(source: string): string {
  return blankSpans(source, true);
}

/**
 * The JSX tag enclosing `index`, as its opening-tag text, or null when the index
 * is not inside one. Brace-aware, so a `>` inside `style={{…}}` does not end it.
 */
export function enclosingTag(source: string, index: number): string | null {
  // The innermost, not the first: a tag whose props hold JSX — `overlays={…}`
  // on GameTable — spans every node inside it, and the outermost match would
  // report the parent for each of its children.
  const containing = jsxTags(source).filter(
    (t) => !t.isClose && t.start <= index && index <= t.end
  );
  return containing.at(-1)?.text ?? null;
}

export interface JsxTag {
  name: string;
  isClose: boolean;
  selfClose: boolean;
  start: number;
  end: number;
  text: string;
}

/**
 * Every JSX tag in `source`, in document order. Brace-aware for the same
 * reason `enclosingTag` is: a `>` inside `style={{…}}` does not end a tag.
 * Walking a subtree needs the closers too, which is what this adds.
 */
export function jsxTags(source: string): JsxTag[] {
  const out: JsxTag[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "<") continue;
    const isClose = source[i + 1] === "/";
    const name = /^[A-Za-z][\w.]*/.exec(source.slice(i + (isClose ? 2 : 1)));
    if (!name) continue;
    let depth = 0;
    let end = -1;
    for (let j = i; j < source.length; j++) {
      const c = source[j];
      // A quoted attribute value is opaque: one `}` in a string title would
      // otherwise unbalance the count and swallow every child up to the next
      // `>`, reporting the control clean.
      if (c === '"' || c === "'" || c === "`") {
        const close = source.indexOf(c, j + 1);
        if (close === -1) break;
        j = close;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        end = j;
        break;
      }
    }
    if (end === -1) continue;
    const text = source.slice(i, end + 1);
    out.push({ name: name[0], isClose, selfClose: text.endsWith("/>"), start: i, end, text });
    // Deliberately not `i = end`: a prop can hold JSX — `overlays={(veiled) =>
    // (…)}` on GameTable — and jumping the tag's span would skip every node
    // declared inside it.
  }
  return out;
}

/** The index just past the `}` that closes the `{` at `open`. */
function closingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return i;
  }
  return source.length;
}

const FULL_BLEED = (body: string): boolean =>
  /absoluteFill(Object)?\b/.test(body) ||
  (/position:\s*["']absolute["']/.test(body) &&
    /top:\s*0/.test(body) &&
    /bottom:\s*0/.test(body));

/**
 * Every `object.style` in `source` naming a style that covers its whole parent.
 *
 * Qualified by the object, because the style and the node that wears it need not share a
 * file — `rotateOverlay.tsx` wears `portraitOverlayStyles.overlay`, which `chrome.tsx`
 * declares, and an unqualified scan cannot see across that import.
 *
 * Braces are balanced rather than matched to the first closing line: a non-greedy body
 * swallows the entries after it, and every name in the block inherits the first full-bleed one.
 */
export function fullBleedAccessors(source: string): string[] {
  return [...styleSheetEntries(source)].filter(([, body]) => FULL_BLEED(body)).map(([name]) => name);
}

/**
 * Every `object.style` a `StyleSheet.create` in `source` declares, with that entry's body.
 *
 * The map, rather than a filtered list, because two guards ask different questions of the same
 * blocks — whether a style covers its parent, and whether it declares a touch floor.
 */
export function styleSheetEntries(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const sheet of source.matchAll(/(\w+)\s*=\s*StyleSheet\.create\(\{/g)) {
    const open = sheet.index + sheet[0].length - 1;
    const end = closingBrace(source, open);
    let at = open + 1;
    while (at < end) {
      const entry = /(\w+)\s*:\s*\{/.exec(source.slice(at, end));
      if (!entry) break;
      const entryOpen = at + entry.index + entry[0].length - 1;
      const entryEnd = closingBrace(source, entryOpen);
      out.set(`${sheet[1]}.${entry[1]}`, source.slice(entryOpen + 1, entryEnd));
      at = entryEnd + 1;
    }
  }
  return out;
}

/** Tags whose whole purpose is to receive a press. */
const PRESSABLE = /<(?:Pressable|Touchable[A-Za-z]*)\b/g;

export type PressableNode = {
  /** 1-based, so a failure names a place someone can open. */
  line: number;
  tag: string;
  /** The `object.style` names its `style=` expression mentions, in source order. */
  accessors: string[];
};

const ACCESSOR = /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/g;

/**
 * Every pressable node in `source`, with the style accessors it wears.
 *
 * The `style={…}` expression is balanced rather than read to the end of the tag: everything
 * after `style=` also holds `onPress`, `accessibilityLabel` and a translation key, and an
 * accessor scan over all of that reads `t("auth.tabLogin")` as a style.
 */
export function pressableNodes(source: string): PressableNode[] {
  const s = blankComments(source);
  const out: PressableNode[] = [];
  for (const m of s.matchAll(PRESSABLE)) {
    const tag = enclosingTag(s, m.index + 1);
    if (!tag) continue;
    const at = tag.search(/\bstyle=\{/);
    let expr = "";
    if (at !== -1) {
      const open = tag.indexOf("{", at);
      expr = tag.slice(open, closingBrace(tag, open) + 1);
    }
    out.push({
      line: s.slice(0, m.index).split("\n").length,
      tag,
      accessors: [...new Set([...expr.matchAll(ACCESSOR)].map((a) => `${a[1]}.${a[2]}`))],
    });
  }
  return out;
}

const SIZE = /\b(min)?(Height|Width|height|width)\s*:\s*(TOUCH_TARGET_MIN|\d+(?:\.\d+)?)/g;

/** The top level of a `{…}` body, with every nested object blanked out. */
function topLevel(body: string): string {
  let depth = 0;
  return [...body].map((c) => (c === "{" ? (depth++, " ") : c === "}" ? (depth--, " ") : depth ? " " : c)).join("");
}

export type Box = { width: number | null; height: number | null };

/**
 * The box `body` declares, per dimension, with the token resolved to `floor`.
 *
 * Per dimension and not as one number, because a target has to be wide enough *and* tall
 * enough: `{ width: 200, height: 20 }` is a 20pt-tall control, however wide it is. A `null`
 * dimension is one no style declares — it comes from padding, from flex or from a runtime
 * prop, which is not decidable from source and so is a question for the caller rather than
 * a pass.
 *
 * Only the top level counts: `shadowOffset: { width: 44, height: 44 }` is an offset, not a box.
 */
export function declaredBox(body: string, floor: number): Box {
  const out: Box = { width: null, height: null };
  for (const m of topLevel(body).matchAll(SIZE)) {
    const side = m[2].toLowerCase() === "width" ? "width" : "height";
    const n = m[3] === "TOUCH_TARGET_MIN" ? floor : Number(m[3]);
    out[side] = Math.max(out[side] ?? 0, n);
  }
  return out;
}

/**
 * What `hitSlop` adds to each dimension: the declared inset lands on both opposing edges.
 * A form this does not read returns 0, which understates the node and sends it to be
 * classified rather than silently passing it.
 */
export function hitSlopGrowth(tag: string, spacing: Record<string, number>): number {
  const m = /hitSlop=\{\s*(?:Spacing\.(\w+)|(\d+(?:\.\d+)?))\s*\}/.exec(tag);
  if (!m) return 0;
  const inset = m[1] !== undefined ? spacing[m[1]] : Number(m[2]);
  return typeof inset === "number" ? inset * 2 : 0;
}

/**
 * Every JSX node in `source` that covers its whole parent — `StyleSheet.absoluteFill` or one
 * of `accessors`, which the caller widens with the accessors of every style sheet this file
 * imports. What such a node covers is not decidable from source, which is the point: the
 * caller refuses an unclassified one rather than judging it.
 */
export function fullBleedNodes(source: string, accessors: string[] = []): string[] {
  const all = [...new Set([...fullBleedAccessors(source), ...accessors])];
  const markers = [
    /StyleSheet\.absoluteFill\b/g,
    ...all.map((a) => new RegExp(a.replace(".", String.raw`\.`) + String.raw`\b`, "g")),
  ];
  const byPosition = new Map<number, string>();
  for (const re of markers) {
    for (const m of source.matchAll(re)) {
      const tag = enclosingTag(source, m.index);
      if (tag && /\bstyle=/.test(tag)) byPosition.set(source.indexOf(tag), tag);
    }
  }
  return [...byPosition.values()];
}

/**
 * A node that can neither hide a control nor take a touch. `pointerEvents: "none"` says so
 * outright, as a prop or inside the style; otherwise a node with no children hides nothing,
 * and one that is neither a touchable nor carries a press handler intercepts nothing — a
 * background fill, in other words. Read off the node, never the file: a file with one
 * decoration and one real blocker was exempted whole before, and that is the same blind spot
 * the curated list already had.
 */
export function coversNothing(tag: string): boolean {
  if (/pointerEvents(?:=|:)\s*(?:\{\s*)?["']none["']/.test(tag)) return true;
  const childless = tag.trimEnd().endsWith("/>");
  const interactive =
    /^<(?:Pressable|Touchable\w*)\b/.test(tag) || /\bon(?:Press|LongPress|Click)\s*=/.test(tag);
  return childless && !interactive;
}
