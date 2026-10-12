// Preloaded by `npm run loop:test` (package.json): a loop tool defaults parameters from the LOOP_*
// its own process was handed, so a test run from inside a loop would otherwise see the loop's state.
// A test that wants one sets it itself, after this has run.
for (const name of Object.keys(process.env)) {
  if (name.startsWith("LOOP_")) delete process.env[name];
}
