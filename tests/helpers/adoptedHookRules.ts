// tests/helpers/adoptedHookRules.ts — the three eslint-plugin-react-hooks rules
// #891 adopted, for the two gates that are both about them: `tests/hooksLint.test.ts`
// refuses a suppression of one, `tests/reactCompiler.test.ts` measures what one costs.

/**
 * `react-hooks/refs` and `react-hooks/globals` are on by default and named
 * nowhere in `eslint.config.js`, so this cannot be derived from the config the
 * way the directories it covers are. `tests/reactCompiler.test.ts` holds it
 * against the rules the plugin still ships.
 */
export const ADOPTED = [
  "react-hooks/set-state-in-effect",
  "react-hooks/globals",
  "react-hooks/refs",
];
