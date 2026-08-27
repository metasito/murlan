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
