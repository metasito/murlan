/**
 * `npm run server:prod`: the built server with `NODE_ENV=production`. The variable is set here
 * because `NODE_ENV=production node …` in an npm script is not a command under cmd.exe.
 */
import path from "node:path";
import { isInvokedDirectly } from "./lib/entry.mjs";
import { relay } from "./lib/proc.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  process.env.NODE_ENV = "production";
  relay(process.execPath, [path.join(ROOT, "server_dist", "index.mjs"), ...process.argv.slice(2)]);
}
