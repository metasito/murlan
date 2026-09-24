// Every EXPO_PUBLIC_E2E_* flag is inlined into the bundle, so the production
// build refuses one from the environment or from any .env file `expo export`
// would load.
const { parseProjectEnv } = require("@expo/env");

const E2E_FLAG = /^EXPO_PUBLIC_E2E_/;

function e2eFlagsSet(projectRoot) {
  const sources = [
    process.env,
    parseProjectEnv(projectRoot, { mode: "production", silent: true, systemEnv: {} }).env,
  ];
  const set = sources.flatMap((env) => Object.keys(env).filter((key) => E2E_FLAG.test(key) && env[key]));
  return [...new Set(set)];
}

const set = e2eFlagsSet(process.cwd());
if (set.length > 0) {
  console.error(`${set.join(", ")} set — this build would ship test-only behaviour.`);
  process.exit(1);
}
