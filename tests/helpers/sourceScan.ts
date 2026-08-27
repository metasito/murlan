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
  const out: string[] = [];
  for (const sheet of source.matchAll(/(\w+)\s*=\s*StyleSheet\.create\(\{/g)) {
    const open = sheet.index + sheet[0].length - 1;
    const end = closingBrace(source, open);
    let at = open + 1;
    while (at < end) {
      const entry = /(\w+)\s*:\s*\{/.exec(source.slice(at, end));
      if (!entry) break;
      const entryOpen = at + entry.index + entry[0].length - 1;
      const entryEnd = closingBrace(source, entryOpen);
      if (FULL_BLEED(source.slice(entryOpen + 1, entryEnd))) out.push(`${sheet[1]}.${entry[1]}`);
      at = entryEnd + 1;
    }
  }
  return out;
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
