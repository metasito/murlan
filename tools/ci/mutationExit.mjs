// Preloaded into every test file Stryker runs (`tap.nodeArgs` in stryker.config.mjs). It must not import
// node:test: that installs the runner's process listeners before the file's own module scope, and
// tests/server/bootFailure.test.ts counts them there.
//
// Once nothing but the pino-pretty worker's MessagePort and the stdio pipes has held the process open for
// a second, it gives the test runner the `beforeExit` a drained event loop would have. The summary and
// the exit code then come from the runner, red files included, and a test still pending is cancelled as
// on a natural exit.
const INERT = new Set(["MessagePort", "PipeWrap"]);
const IDLE_POLLS = 5;
let idle = 0;
const watch = setInterval(() => {
  idle = process.getActiveResourcesInfo().every((resource) => INERT.has(resource)) ? idle + 1 : 0;
  if (idle < IDLE_POLLS) return;
  clearInterval(watch);
  process.emit("beforeExit", process.exitCode ?? 0);
  setTimeout(() => process.exit(), 500);
}, 200);
watch.unref();
