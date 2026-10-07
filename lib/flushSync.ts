/** Only the web e2e hooks need a synchronous commit (`flushSync.web.ts`); native has no react-dom. */
export const flushSync = <T>(fn: () => T): T => fn();
