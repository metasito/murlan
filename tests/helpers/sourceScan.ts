import { readdirSync } from "node:fs";
import path from "node:path";

/** The two trees that hold rendered UI. A guard that scans one of them scans both. */
const SCANNED_DIRS = ["components", "app"];

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
 * Blanking, not removing: every offset in the result still points at the line
 * it came from, so a scan can report where it found something.
 *
 * A source scan that reads comments as code fails on prose — a comment naming
 * `<Modal>` is not a modal, and the report is a red run with nothing to fix.
 */
const blank = (m: string) => m.replace(/[^\n]/g, " ");

/** `//` and block comments. `[^:]` leaves the `//` of a URL alone. */
export function blankComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (_, before: string, comment: string) => before + blank(comment));
}

/**
 * Comments and every string literal. Use this only when the scan is looking
 * for code: a scan reading JSX attribute values needs the strings kept.
 */
export function blankCommentsAndStrings(source: string): string {
  return blankComments(source)
    .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, blank)
    .replace(/'(?:\\.|[^'\\])*'/g, blank)
    .replace(/"(?:\\.|[^"\\])*"/g, blank);
}

/**
 * The JSX tag enclosing `index`, as its opening-tag text, or null when the index
 * is not inside one. Brace-aware, so a `>` inside `style={{…}}` does not end it.
 */
export function enclosingTag(source: string, index: number): string | null {
  let open = -1;
  for (let i = index; i >= 0; i--) {
    if (source[i] === "<" && /[A-Za-z]/.test(source[i + 1] ?? "")) {
      open = i;
      break;
    }
    if (source[i] === ">") return null;
  }
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return source.slice(open, i + 1);
  }
  return null;
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
  /absoluteFillObject/.test(body) ||
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

const SIZE = /\b(?:minHeight|minWidth|height|width)\s*:\s*(TOUCH_TARGET_MIN|\d+(?:\.\d+)?)/g;

/**
 * The largest box `body` declares, with the token resolved to `floor`, or null when it declares
 * none — a box that comes from padding, from flex or from a runtime prop reads as null, which is
 * a question for the caller rather than a pass.
 */
export function declaredBox(body: string, floor: number): number | null {
  const sizes = [...body.matchAll(SIZE)].map((m) =>
    m[1] === "TOUCH_TARGET_MIN" ? floor : Number(m[1])
  );
  return sizes.length ? Math.max(...sizes) : null;
}

/**
 * What `hitSlop` adds to each dimension: the declared inset lands on both opposing edges.
 * A form this does not read returns 0, which understates the node and sends it to be
 * classified rather than silently passing it.
 */
export function hitSlopGrowth(tag: string, spacing: Record<string, number> = {}): number {
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
