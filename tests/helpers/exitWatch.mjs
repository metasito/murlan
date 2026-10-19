// A file's deadline once its exit has begun, started by tests/helpers/fileDeadline.mjs: from then on
// nothing inside that process, its own deadline's worker included, can be relied on to end it.
import { writeSync } from "node:fs";
import { killOverdue } from "../../scripts/lib/proc.mjs";

const [pid, ms, file] = process.argv.slice(2);
await killOverdue(Number(pid), Number(ms), () =>
  writeSync(2, `\n${file}: hung after its tests finished, killed ${Number(ms) / 1000}s into its exit by tests/helpers/exitWatch.mjs\n`)
);
