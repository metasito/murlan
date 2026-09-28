import type React from "react";

const Bench: () => React.ReactElement | null =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a static import would ship the bench
  process.env.EXPO_PUBLIC_DIAGNOSTICS === "1" ? require("@/components/BenchScreen").BenchScreen : () => null;

export default Bench;
