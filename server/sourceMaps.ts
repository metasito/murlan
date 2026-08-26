// Resolves a minified web crash frame to a real file and line, at read time
// on /admin — never at insert, which is fire-and-forget on the crash path
// (server/clientErrors.ts) and must stay cheap.
//
// Reads from sourcemaps/, where scripts/moveSourceMaps.mjs puts every .map
// after `expo export --source-maps` — never from dist/, which server/app.ts
// serves wholesale. Maps are per-build: a frame from an older deploy has no
// matching file on disk here and falls back to its raw minified text, same
// as before this existed.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SourceMapConsumer } from "source-map";

const MAPS_ROOT = path.resolve(process.cwd(), "sourcemaps");

// One stack frame, matched from the end so V8's "at fn (url:line:col)",
// V8's anonymous "at url:line:col", and Safari/Hermes' "fn@url:line:col"
// all pass through the same pattern.
const FRAME = /([^\s(@]+):(\d+):(\d+)\)?\s*$/;

interface ParsedFrame {
  url: string;
  line: number;
  column: number;
}

function parseFrame(raw: string): ParsedFrame | null {
  const m = FRAME.exec(raw.trim());
  if (!m) return null;
  const [, url, line, column] = m;
  if (url === undefined || line === undefined || column === undefined) return null;
  return { url, line: Number(line), column: Number(column) };
}

/**
 * `raw` is client-supplied text (server/schemas.ts's ClientErrorSchema), so
 * the resolved path must never leave MAPS_ROOT — checked explicitly rather
 * than trusted from the URL parse alone.
 */
function mapPathFor(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url, "http://_/").pathname;
  } catch {
    return null;
  }
  const full = path.join(MAPS_ROOT, `${pathname}.map`);
  return full === MAPS_ROOT || full.startsWith(MAPS_ROOT + path.sep) ? full : null;
}

// ponytail: re-read per lookup, cached only by path — this app has two map
// files and one reader (the owner, occasionally). Cache parsed consumers
// instead if /admin read volume ever makes that worth the lifecycle cost.
const rawMapCache = new Map<string, string | null>();

function readMapFile(mapPath: string): string | null {
  const cached = rawMapCache.get(mapPath);
  if (cached !== undefined) return cached;
  const text = existsSync(mapPath) ? readFileSync(mapPath, "utf8") : null;
  rawMapCache.set(mapPath, text);
  return text;
}

/**
 * The frame's original source and line, or the frame's own trimmed text
 * when no build map covers it — an unrecognized shape, a non-web platform,
 * or a deploy this process has no map for.
 */
export async function symbolicate(raw: string | null | undefined): Promise<string | null> {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const frame = parseFrame(trimmed);
  if (!frame) return trimmed;
  const mapPath = mapPathFor(frame.url);
  const mapText = mapPath && readMapFile(mapPath);
  if (!mapText) return trimmed;
  try {
    return await SourceMapConsumer.with(mapText, null, (consumer) => {
      // V8 stack columns are 1-based; the source map spec's are 0-based.
      const pos = consumer.originalPositionFor({ line: frame.line, column: frame.column - 1 });
      return pos.source
        ? `${pos.source}:${pos.line}${pos.name ? ` (${pos.name})` : ""}`
        : trimmed;
    });
  } catch {
    return trimmed;
  }
}
