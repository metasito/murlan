/**
 * The route table `expo-router` builds is a `require.context` over `app/`, and
 * an empty one is silent: the bundle still boots, still carries `_layout`, and
 * every route 404s at runtime. `scripts/e2e-server.mjs` calls this straight
 * after the export so that failure is named once, rather than read off a
 * browser suite in which every spec waits out its own timeout (#438).
 *
 * The expected keys come from `app/` rather than a list, so a route added
 * tomorrow is covered without anyone remembering this file.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The filename shapes `expo-router/_ctx.web.js` excludes from its context.
 * Mirrored from that regex — server-side and platform-shim files are real
 * source but never routes, so requiring them here would fail on a correct
 * bundle.
 */
const NOT_A_ROUTE = /(\+api|\+html|\+middleware|\+native-intent)\.[tj]sx?$/;
const SOURCE = /\.[tj]sx?$/;

/** Every route key the context should carry, as it appears in the bundle. */
export function expectedRouteKeys(appDir) {
  const keys = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (SOURCE.test(entry.name) && !NOT_A_ROUTE.test(entry.name)) keys.push(`./${rel}`);
    }
  };
  walk(appDir, "");
  return keys;
}

/** The web bundle's own text, whatever the export happened to name it. */
function readWebBundle(distDir) {
  const jsDir = path.join(distDir, "_expo", "static", "js", "web");
  let bundles = [];
  try {
    bundles = readdirSync(jsDir).filter((f) => f.endsWith(".js"));
  } catch {
    // A missing directory and an empty one are the same failure to report.
  }
  if (bundles.length === 0) throw new Error(`the export produced no web bundle under ${jsDir}`);
  return bundles.map((f) => readFileSync(path.join(jsDir, f), "utf8")).join("\n");
}

export function missingRoutes(bundle, appDir) {
  return expectedRouteKeys(appDir).filter((key) => !bundle.includes(JSON.stringify(key)));
}

export function assertBundleHasRoutes(distDir, appDir) {
  const expected = expectedRouteKeys(appDir);
  const missing = missingRoutes(readWebBundle(distDir), appDir);
  if (missing.length === 0) return;
  throw new Error(
    `The exported bundle carries no route for ${missing.length} of ${expected.length} ` +
      `files under ${appDir}:\n` +
      missing.map((m) => `  ${m}`).join("\n") +
      `\n\nexpo-router's context resolved somewhere other than this checkout's app/. ` +
      `A stale Metro transform cache is the usual cause — see docs/agents/loops.md, ` +
      `*Metro's cache is machine-wide*. \`npx expo export --platform web --clear\` confirms it.`
  );
}
