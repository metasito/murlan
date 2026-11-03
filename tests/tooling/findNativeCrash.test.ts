// tools/ci/find-native-crash.mjs is what fails a device run whose app died. Each report below is
// trimmed to the lines the finder reads, in the shape the platform writes: an Android tombstone as
// logcat prints it, and an iOS `.ips` (a JSON header line, then a JSON body).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { androidAnr, androidCrash, androidTombstone, iosCrash } from "../../tools/ci/find-native-crash.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP = "com.murlan.cardgame";

const tombstone = (pkg: string, signal: string) =>
  [
    "09-21 04:41:02.120  1234  1234 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***",
    "09-21 04:41:02.121  1234  1234 F DEBUG   : Build fingerprint: 'google/sdk_gphone64_x86_64/emu64xa:14'",
    `09-21 04:41:02.122  1234  1234 F DEBUG   : Cmdline: ${pkg}`,
    `09-21 04:41:02.123  1234  1234 F DEBUG   : pid: 4321, tid: 4400, name: RenderThread  >>> ${pkg} <<<`,
    "09-21 04:41:02.124  1234  1234 F DEBUG   : uid: 10150",
    `09-21 04:41:02.125  1234  1234 F DEBUG   : ${signal}, code 1 (SEGV_MAPERR), fault addr 0x0`,
  ].join("\n");

const anr = (pkg: string) => `10-01 04:54:28.313   520   600 E ActivityManager: ANR in ${pkg}`;

const ips = (bundleID: string, exception = { type: "EXC_CRASH", signal: "SIGABRT" }) =>
  JSON.stringify({ app_name: "Murlan", bug_type: "309", platform: 7, bundleID, name: "Murlan" }) +
  "\n" +
  JSON.stringify({ procName: "Murlan", bundleInfo: { CFBundleIdentifier: bundleID }, exception }, null, 2);

const dirWith = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(tmpdir(), "native-crash-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
};

const run = (...args: string[]) =>
  spawnSync(process.execPath, ["tools/ci/find-native-crash.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: "" },
  });

describe("Android", () => {
  test("our own tombstone is a crash, named by process, thread and signal", () => {
    const text = [tombstone("com.android.systemui", "signal 6 (SIGABRT)"), tombstone(APP, "signal 11 (SIGSEGV)")].join("\n");
    assert.deepEqual(androidCrash(APP, text), { process: APP, thread: "RenderThread", signal: "signal 11 (SIGSEGV)" });
  });

  test("another process's tombstone, or a package that only starts with ours, is not our crash", () => {
    assert.equal(androidCrash(APP, tombstone("com.android.systemui", "signal 6 (SIGABRT)")), null);
    assert.equal(androidCrash(APP, tombstone(`${APP}x`, "signal 6 (SIGABRT)")), null);
  });

  test("a crash in one of our own subprocesses is ours", () => {
    assert.equal(androidCrash(APP, tombstone(`${APP}:remote`, "signal 6 (SIGABRT)"))?.process, `${APP}:remote`);
  });

  test("the system's ANR of our app is named by its own line; the window's and another package's are not", () => {
    const window = `10-01 04:54:26.143   520   600 I WindowManager: ANR in Window{a1b2c3 u0 ${APP}/${APP}.MainActivity}. Reason:Input dispatching timed out`;
    assert.equal(androidAnr(APP, window), null);
    assert.equal(androidAnr(APP, anr(`${APP}x`)), null);
    assert.equal(androidAnr(APP, anr("com.android.systemui")), null);
    assert.deepEqual(androidAnr(APP, [window, anr(APP)].join("\n")), { process: APP, line: anr(APP) });
    assert.equal(androidAnr(APP, `${anr(`${APP}:remote`)} (${APP}/.MainActivity)`)?.process, `${APP}:remote`);
  });
});

describe("iOS", () => {
  test("a report for our bundle id is a crash, named by process and exception", () => {
    assert.deepEqual(iosCrash(APP, ips(APP)), { process: "Murlan", signal: "EXC_CRASH (SIGABRT)" });
  });

  test("a report for another bundle id is not our crash", () => {
    assert.equal(iosCrash(APP, ips("com.apple.springboard")), null);
    assert.equal(iosCrash(APP, ips(`${APP}x`)), null);
  });

  test("a legacy .crash report is read by its Identifier line", () => {
    const legacy = `Process:               Murlan [4321]\nIdentifier:            ${APP}\nException Type:        EXC_BAD_ACCESS (SIGSEGV)\n`;
    assert.deepEqual(iosCrash(APP, legacy), { process: "Murlan", signal: "EXC_BAD_ACCESS (SIGSEGV)" });
  });
});

describe("the command a device run calls", () => {
  test("Android: a tombstone in the streamed logcat fails the step with an error naming it", () => {
    const dir = dirWith({ "maestro/run/commands.json": "{}", "logcat.txt": tombstone(APP, "signal 11 (SIGSEGV)") });
    const result = run("android", APP, path.join(dir, "maestro"), path.join(dir, "logcat.txt"));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^::error::.*RenderThread.*com\.murlan\.cardgame.*signal 11 \(SIGSEGV\).*logcat\.txt/m);
    assert.doesNotMatch(result.stdout, /::warning::/);
  });

  test("Android: an ANR of our app in the streamed logcat fails the step, printing the ANR line", () => {
    const flood = `10-01 04:54:21.001  6755  6755 W Reanimated: synchronouslyUpdateUIProps failed for tag 412`;
    const dir = dirWith({ "maestro/run/maestro.log": "Tap on id: btn-next-round COMPLETED", "logcat.txt": [flood, anr(APP)].join("\n") });
    const result = run("android", APP, path.join(dir, "maestro"), path.join(dir, "logcat.txt"));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^::error::The app died during this run: com\.murlan\.cardgame was not responding.*E ActivityManager: ANR in com\.murlan\.cardgame.*logcat\.txt/m);
  });

  test("iOS: a report for our app fails the step and is copied out for upload", () => {
    const dir = dirWith({
      "reports/Murlan-2026-09-21-044102.ips": ips(APP),
      "reports/Retired/SpringBoard-2026-09-21-044000.ips": ips("com.apple.springboard"),
    });
    const out = path.join(dir, "upload");
    const result = run("ios", APP, "--copy-to", out, path.join(dir, "reports"));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^::error::.*Murlan.*EXC_CRASH \(SIGABRT\).*Murlan-2026-09-21-044102\.ips/m);
    assert.deepEqual(readdirSync(out), ["Murlan-2026-09-21-044102.ips"]);
  });

  test("no report of ours passes, and says how much it read", () => {
    const dir = dirWith({ "Retired/SpringBoard.ips": ips("com.apple.springboard") });
    const result = run("ios", APP, dir, path.join(dir, "missing"));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /read 1 report/);
    assert.doesNotMatch(result.stdout, /::error::/);
  });
});

describe("the tombstone in the run's log", () => {
  const backtrace = [
    "09-21 04:41:02.126  1234  1234 F DEBUG   : backtrace:",
    "09-21 04:41:02.127  1234  1234 F DEBUG   :       #00 pc 0000000000012345  /data/app/lib/x86_64/libreanimated.so",
  ];
  const next = "09-21 04:41:03.000  1234  1234 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***";

  test("runs from our header to the end of its backtrace, and stops at the next tombstone", () => {
    const text = [tombstone(APP, "signal 11 (SIGSEGV)"), "09-21 04:41:02.126  999  999 I ActivityManager: unrelated", ...backtrace, next, tombstone("com.android.systemui", "signal 6 (SIGABRT)")].join("\n");
    const lines = androidTombstone(APP, text);
    assert.match(lines[0], /name: RenderThread {2}>>> com\.murlan\.cardgame <<</);
    assert.ok(lines.at(-1)!.includes("libreanimated.so"));
    assert.ok(!lines.some((l) => l.includes("ActivityManager") || l.includes("systemui")));
  });

  test("reads logcat's -v time form too, the one the device workflows write", () => {
    const text = `11-03 03:10:01.123 F/DEBUG   ( 1234): pid: 4321, tid: 4400, name: mqt_v_js  >>> ${APP} <<<\n11-03 03:10:01.124 F/DEBUG   ( 1234):       #00 pc 0000abcd  /lib/libhermes.so`;
    assert.equal(androidTombstone(APP, text).length, 2);
  });

  test("the finder prints it for a crash it reports", () => {
    const dir = dirWith({ "logcat.txt": [tombstone(APP, "signal 11 (SIGSEGV)"), ...backtrace].join("\n") });
    const out = run("android", APP, dir);
    assert.equal(out.status, 1);
    assert.match(out.stdout, /::group::The tombstone in [^\n]+\n[^\n]*>>> com\.murlan\.cardgame <<<[\s\S]*libreanimated\.so\n::endgroup::/);
  });
});
