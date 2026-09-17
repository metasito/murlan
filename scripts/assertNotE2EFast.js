// Every EXPO_PUBLIC_E2E_* flag is inlined into the bundle, so a production build
// refuses one from the environment or from any .env file Expo CLI would load —
// `expo export` reads the production set, `expo start` (scripts/build.js) the
// development one.
const { parseProjectEnv } = require("@expo/env");

const E2E_FLAG = /^EXPO_PUBLIC_E2E_/;

function e2eFlagsSet(projectRoot) {
  const sources = [
    process.env,
    ...["production", "development"].map(
      (mode) => parseProjectEnv(projectRoot, { mode, silent: true, systemEnv: {} }).env
    ),
  ];
  const set = sources.flatMap((env) => Object.keys(env).filter((key) => E2E_FLAG.test(key) && env[key]));
  return [...new Set(set)];
}

function assertNoE2EFlags(projectRoot = process.cwd()) {
  const set = e2eFlagsSet(projectRoot);
  if (set.length === 0) return;
  console.error(`${set.join(", ")} set — this build would ship test-only behaviour.`);
  process.exit(1);
}

module.exports = { assertNoE2EFlags };

if (require.main === module) assertNoE2EFlags();
