import { syncMain } from "../server/devSyncHook.ts";

// The push hook is served by this workspace's own dev server, so it can only
// be reached while the workspace is already awake. Booting is the only other
// chance a Repl that slept through a push gets to catch up.
syncMain().then(
  ({ updated, sha }) => {
    console.log(`dev-sync: ${updated ? "updated to" : "already at"} ${sha}`);
  },
  (error: unknown) => {
    // Never hold the app hostage to a fetch: a workspace on stale code still
    // runs, and the next boot or push tries again.
    console.warn("dev-sync: could not reach origin/main, starting on the checkout as it is");
    console.warn(error instanceof Error ? error.message : error);
  }
);
