import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { RESTART } from "./queue-loop.mjs";

export function supervise(
  spawn = (args) => spawnSync(process.execPath, args, { stdio: "inherit" }).status ?? 1,
  script = fileURLToPath(new URL("./queue-loop.mjs", import.meta.url)),
) {
  let code;
  do code = spawn([script, ...process.argv.slice(2)]);
  while (code === RESTART);
  return code;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) process.exit(supervise());
