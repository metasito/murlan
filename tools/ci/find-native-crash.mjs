// Fails a device run whose app died of a native crash, or on Android of an ANR.
//
//   node tools/ci/find-native-crash.mjs <android|ios> <app id> [--copy-to <dir>] <path>...
//
// Reads every report under the paths (Android: logcat and Maestro's output; iOS: the host's
// DiagnosticReports), prints `::error::` and exits 1 on a crash or ANR of the app's own process.
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

/**
 * The app's own tombstone as logcat printed it, from its header to the end of its backtrace, so the run's
 * log carries the frames: the artifact holding the whole logcat is not always readable from where a run is read.
 * @returns {string[]}
 */
export function androidTombstone(appId, text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const at = lines.findIndex((line) => new RegExp(`>>> ${escape(appId)}(?::\\S+)? <<<`).test(line));
  if (at === -1) return [];
  const tail = lines.slice(at, at + 400).filter((line) => /\bDEBUG\b/.test(line));
  const end = tail.findIndex((line, i) => i > 0 && /\*\*\* \*\*\* \*\*\*/.test(line));
  return (end === -1 ? tail : tail.slice(0, end)).slice(0, 120);
}

/** `{ process, line }` of the ActivityManager's ANR of the app in a logcat, or null. */
export function androidAnr(appId, text) {
  const match = new RegExp(`^.*\\bANR in (${escape(appId)}(?::\\S+)?)(?=\\s|$).*$`, "m").exec(text.replace(/\r/g, ""));
  return match ? { process: match[1], line: match[0].trim() } : null;
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

/**
 * What an iOS `.ips` says about why the app died: the abort's own message (`asi`, where React Native
 * writes an unhandled JS exception), the exception's backtrace, and the crashed thread's top frames.
 * @returns {string[]}
 */
export function iosCrashDetail(text) {
  const newline = text.indexOf("\n");
  const body = newline === -1 ? null : parse(text.slice(newline + 1));
  if (!body) return [];
  const images = body.usedImages ?? [];
  const frame = (f) => `  ${images[f.imageIndex]?.name ?? "?"}  ${f.symbol ?? `+${f.imageOffset}`}`;
  const asi = Object.entries(body.asi ?? {}).flatMap(([image, messages]) => [].concat(messages).map((m) => `asi ${image}: ${m}`));
  const thrown = (body.lastExceptionBacktrace ?? []).slice(0, 25).map(frame);
  const crashed = (body.threads ?? []).find((t) => t.triggered);
  return [
    ...asi,
    ...(thrown.length > 0 ? ["last exception backtrace:", ...thrown] : []),
    ...(crashed ? [`crashed thread ${crashed.name ?? crashed.queue ?? ""}:`, ...(crashed.frames ?? []).slice(0, 25).map(frame)] : []),
  ];
}

const PLATFORMS = {
  android: {
    reads: (file) => !/\.(png|jpe?g|gif|mp4|webm|zip)$/i.test(file),
    find: (appId, text) => androidCrash(appId, text) ?? androidAnr(appId, text),
    detail: androidTombstone,
    describe: (c) => (c.line ? `${c.process} was not responding and was killed (${c.line})` : `${c.thread} in ${c.process} died of ${c.signal}`),
    after:
      "Maestro asserts against a stale hierarchy afterwards, so the step that failed is not where the problem is - read the screenshot beside it.",
  },
  ios: {
    reads: (file) => /\.(ips|crash)$/i.test(file),
    find: iosCrash,
    detail: (_appId, text) => iosCrashDetail(text),
    describe: (c) => `${c.process} died of ${c.signal}`,
    after: "The report is in this shard's crash-reports-ios-<shard> artifact.",
  },
};

function* files(target) {
  let stat;
  try {
    stat = statSync(target);
  } catch {
    return;
  }
  if (stat.isFile()) yield target;
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(target)) yield* files(path.join(target, entry));
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
  for (const file of rest.flatMap((target) => [...files(target)])) {
    if (!spec.reads(file)) continue;
    read++;
    const crash = spec.find(appId, readFileSync(file, "latin1"));
    if (crash) found.push({ file, crash, text: spec.detail(appId, readFileSync(file, "latin1")) });
  }
  if (found.length === 0) {
    console.log(`No native crash of ${appId}: read ${read} report(s) under ${rest.join(", ")}.`);
    return 0;
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "found=true\n");
  for (const { file, crash, text } of found) {
    if (copyTo) {
      mkdirSync(copyTo, { recursive: true });
      copyFileSync(file, path.join(copyTo, path.basename(file)));
    }
    console.log(`::error::The app died during this run: ${spec.describe(crash)}. ${spec.after} Report: ${file}.`);
    if (text.length > 0) console.log([`::group::What ${file} says`, ...text, "::endgroup::"].join("\n"));
  }
  return 1;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) process.exitCode = main(process.argv.slice(2));
