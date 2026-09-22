// tests/helpers/adoptedHookRules.ts — the three eslint-plugin-react-hooks rules
// #891 adopted, held against the rules the plugin ships. Shared by the two gates
// that are both about those three: `tests/ui-rules/hooksLint.test.ts` refuses a suppression
// of one, `tests/ui-rules/reactCompiler.test.ts` measures what one costs.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Every rule the plugin ships, prefixed the way ESLint names it. */
export const SHIPPED = Object.keys(
  (require("eslint-plugin-react-hooks") as { rules: Record<string, unknown> }).rules
).map((name) => `react-hooks/${name}`);

// `react-hooks/refs` and `react-hooks/globals` are on by default and turned on by
// name nowhere in `eslint.config.js`, so this cannot be derived from the config
// the way the directories it covers are.
const NAMES = ["react-hooks/set-state-in-effect", "react-hooks/globals", "react-hooks/refs"];

// Renamed upstream, a gate asking about these goes quiet rather than red: a scan
// matches nothing, and a rule nothing ships is off nowhere. Here it fails every
// importer at once, this list's two and any written after them.
const unshipped = NAMES.filter((rule) => !SHIPPED.includes(rule));
if (unshipped.length > 0) {
  throw new Error(
    `eslint-plugin-react-hooks no longer ships ${unshipped.join(", ")}, so every gate importing ` +
      `this list would pass by asking about a rule that does not exist`
  );
}

export const ADOPTED = NAMES;
