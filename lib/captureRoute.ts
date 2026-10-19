import { e2eFast } from "./e2eConfig.ts";

/** Read per call so a test can flip the flag; a build inlines it. `ci.yml` proves a store build carries no e2e flag. */
export const captureEnabled = () => __DEV__ || e2eFast();
