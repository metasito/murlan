import { E2E_FAST } from "./e2eConfig.ts";

/** Read per call so a test can flip `__DEV__`; the flag is inlined at build time. `ci.yml` proves a store build carries no e2e flag. */
export const captureEnabled = () => __DEV__ || E2E_FAST;
