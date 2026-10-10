/** Read per call so a test can flip the flag; a build inlines it. `ci.yml` proves a store build carries no e2e flag. */
export const captureEnabled = () => __DEV__ || process.env.EXPO_PUBLIC_E2E_FAST === "1";
