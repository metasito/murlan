// --test-force-exit exits a test file's process once its report is handed to stdout, not once the
// pipe to the runner has taken it: a runner slow to read lost the report's tail, the last failures'
// names with it. A blocking write cannot be left queued.
if (process.env.NODE_TEST_CONTEXT) process.stdout._handle?.setBlocking?.(true);
