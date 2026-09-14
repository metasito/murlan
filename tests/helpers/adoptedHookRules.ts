// tests/helpers/adoptedHookRules.ts — the three eslint-plugin-react-hooks rules
// #891 adopted, and the rules the plugin ships to hold them against. Shared by the
// two gates that are both about those three: `tests/hooksLint.test.ts` refuses a
// suppression of one, `tests/reactCompiler.test.ts` measures what one costs.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Every rule the plugin ships, prefixed the way ESLint names it. */
export const SHIPPED = Object.keys(
  (require("eslint-plugin-react-hooks") as { rules: Record<string, unknown> }).rules
).map((name) => `react-hooks/${name}`);

/**
 * `react-hooks/refs` and `react-hooks/globals` are on by default and named nowhere
 * in `eslint.config.js`, so this cannot be derived from the config the way the
 * directories it covers are. Each gate holds it against `SHIPPED` instead: renamed
 * upstream, a gate goes quiet rather than red — the scan matches nothing, and a
 * rule nothing ships is off nowhere.
 */
export const ADOPTED = [
  "react-hooks/set-state-in-effect",
  "react-hooks/globals",
  "react-hooks/refs",
];
