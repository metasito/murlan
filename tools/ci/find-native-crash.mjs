// Fails a device run whose app died of a native crash.
//
//   node tools/ci/find-native-crash.mjs <android|ios> <app id> [--copy-to <dir>] <path>...
//
// Reads every report under the paths (Android: logcat and Maestro's output; iOS: the host's
// DiagnosticReports), prints `::error::` and exits 1 on a crash of the app's own process.
import { appendFileSync, copyFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `{ process, thread, signal }` of the app's own tombstone in a logcat, or null. */
export function androidCrash(appId, text) {
  const lines = text.split("\n");
  const header = new RegExp(`name: (.+?)\\s+>>> (${escape(appId)}(?::\\S+)?) <<<`);
  for (let i = 0; i < lines.length; i++) {
    const match = header.exec(lines[i]);
    if (!match) continue;
    const signal = lines
      .slice(i + 1, i + 7)
      .join("\n")
      .match(/signal \d+ \([A-Z]+\)/)?.[0];
    return { process: match[2], thread: match[1], signal: signal ?? "an unknown signal" };
  }
  return null;
}

const parse = (json) => {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

/** `{ process, signal }` of an iOS crash report (`.ips`, or a legacy `.crash`) for the app, or null. */
export function iosCrash(appId, text) {
  const newline = text.indexOf("\n");
  const header = parse(newline === -1 ? text : text.slice(0, newline));
  if (header) {
    if (header.bundleID !== appId) return null;
    const body = parse(text.slice(newline + 1)) ?? {};
    const { type, signal } = body.exception ?? {};
    return {
      process: body.procName ?? header.name ?? appId,
      signal: type ? `${type}${signal ? ` (${signal})` : ""}` : "an unknown exception",
    };
  }
  if (!new RegExp(`^Identifier:\\s+${escape(appId)}\\s*$`, "m").test(text)) return null;
  return {
    process: text.match(/^Process:\s+(\S+)/m)?.[1] ?? appId,
    signal: text.match(/^Exception Type:\s+(.+?)\s*$/m)?.[1] ?? "an unknown exception",
  };
}

const PLATFORMS = {
  android: {
    reads: (file) => !/\.(png|jpe?g|gif|mp4|webm|zip)$/i.test(file),
    find: androidCrash,
    describe: (c) => `${c.thread} in ${c.process} died of ${c.signal}`,
    after:
      "Maestro asserts against a stale hierarchy afterwards, so the step that failed is not where the problem is - read the screenshot beside it.",
  },
  ios: {
    reads: (file) => /\.(ips|crash)$/i.test(file),
    find: iosCrash,
    describe: (c) => `${c.process} died of ${c.signal}`,
    after: "The report is in the crash-reports-ios artifact.",
  },
};

function* files(root) {
  let stat;
  try {
    stat = statSync(root);
  } catch {
    return;
  }
  if (stat.isFile()) yield root;
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(root)) yield* files(path.join(root, entry));
}

function main([platform, appId, ...rest]) {
  const spec = PLATFORMS[platform];
  if (!spec || !appId) {
    console.error("usage: find-native-crash.mjs <android|ios> <app id> [--copy-to <dir>] <path>...");
    return 2;
  }
  const copyAt = rest.indexOf("--copy-to");
  const copyTo = copyAt === -1 ? null : rest.splice(copyAt, 2)[1];
  let read = 0;
  const found = [];
  for (const file of rest.flatMap((root) => [...files(root)])) {
    if (!spec.reads(file)) continue;
    read++;
    const crash = spec.find(appId, readFileSync(file, "latin1"));
    if (crash) found.push({ file, crash });
  }
  if (found.length === 0) {
    console.log(`No native crash of ${appId}: read ${read} report(s) under ${rest.join(", ")}.`);
    return 0;
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "found=true\n");
  for (const { file, crash } of found) {
    if (copyTo) {
      mkdirSync(copyTo, { recursive: true });
      copyFileSync(file, path.join(copyTo, path.basename(file)));
    }
    console.log(`::error::The app died of a native crash during this run: ${spec.describe(crash)}. ${spec.after} Report: ${file}.`);
  }
  return 1;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) process.exitCode = main(process.argv.slice(2));
