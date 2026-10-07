// react-dom is a dependency without its @types package; this is the one signature used.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const { flushSync } = require("react-dom") as { flushSync: <T>(fn: () => T) => T };
