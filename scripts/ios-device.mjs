#!/usr/bin/env node
/**
 * `npm run ios:device` — the dev build on a real iPhone from Windows, with a free Apple ID (#1316).
 *
 * Waits for the phone, fetches the newest `ios-device.yml` build (dispatching one if there is
 * none), signs and installs it with plumesign when the native fingerprint changed or the 7-day
 * certificate is near expiry, then serves the game on :5000 and Metro on the LAN address.
 * Flags: `--ref <branch>` builds from another branch, `--reinstall` forces a fresh install,
 * `--login` signs in to the Apple ID again, `--diagnostics` serves the diagnostics build and its collector (verdicts unrun), `--bench` installs the Release bench build that gates read.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUMESIGN = {
  version: "2.6.5",
  asset: "plumesign-windows-x86_64.exe",
  sha256: "2311ed3090253bcc63ebb96a92ebca5f373f5344e8462ed089cf3bec6a75186b",
};
const RESIGN_AFTER_MS = 6 * 24 * 60 * 60 * 1000;
const SERVER_PORT = 5000;
const USBMUXD_PORT = 27015;

export function needsInstall(state, { fingerprint, now }) {
  return !state || state.fingerprint !== fingerprint || now - state.installedAt > RESIGN_AFTER_MS;
}

/** The first private IPv4 address on a physical adapter: the one the phone on the same Wi-Fi reaches. */
export function lanAddress(interfaces) {
  const candidates = Object.entries(interfaces)
    .filter(([name]) => !/vEthernet|WSL|Docker|VirtualBox|VMware|Hyper-V|Loopback|Tailscale|ZeroTier/i.test(name))
    .flatMap(([, addrs]) => addrs ?? [])
    .filter((a) => a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
  return candidates.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) ?? null;
}

export function parseDevices(xml) {
  return xml
    .split("<key>Properties</key>")
    .slice(1)
    .map((chunk) => ({
      udid: /<key>SerialNumber<\/key>\s*<string>([^<]+)<\/string>/.exec(chunk)?.[1],
      id: /<key>DeviceID<\/key>\s*<integer>(\d+)<\/integer>/.exec(chunk)?.[1],
      connection: /<key>ConnectionType<\/key>\s*<string>([^<]+)<\/string>/.exec(chunk)?.[1],
    }))
    .filter((d) => d.udid)
    .sort((a, b) => Number(b.connection === "USB") - Number(a.connection === "USB"));
}

/** A build still running is newer than any finished one, and may carry a native change: wait for it. */
export function pickRun(runs) {
  const newest = runs[0];
  if (newest && newest.status !== "completed") return { wait: newest.databaseId };
  const ok = runs.find((r) => r.conclusion === "success");
  if (!ok) return null;
  return ok === newest ? { use: ok.databaseId } : { use: ok.databaseId, newerFailed: newest.databaseId };
}

/** Reads a line from a raw-mode TTY without echoing it; Backspace edits, Ctrl+C exits. */
export function readHidden(input, output, prompt) {
  output.write(prompt);
  return new Promise((resolve) => {
    let line = "";
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === "\u0003") process.exit(130);
        if (ch === "\r" || ch === "\n") {
          input.off("data", onData);
          input.setRawMode(false);
          input.pause();
          output.write("\n");
          return resolve(line);
        }
        line = ch === "\u007f" || ch === "\b" ? line.slice(0, -1) : line + ch;
      }
    };
    input.setRawMode(true);
    input.on("data", onData);
    input.resume();
  });
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function gh(args, opts = {}) {
  const r = spawnSync("gh", args, { cwd: ROOT, encoding: "utf8", ...opts });
  if (r.status !== 0) fail(`gh ${args.join(" ")} failed:\n${r.stderr ?? ""}`);
  return r.stdout;
}

function usbmuxd(message) {
  const body = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>` +
      Object.entries({ ClientVersionString: "murlan", ProgName: "murlan", ...message })
        .map(([k, v]) => `<key>${k}</key><string>${v}</string>`)
        .join("") +
      `</dict></plist>`,
  );
  const header = Buffer.alloc(16);
  header.writeUInt32LE(16 + body.length, 0);
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(8, 8);
  header.writeUInt32LE(1, 12);
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const socket = net.connect(USBMUXD_PORT, "127.0.0.1", () => socket.write(Buffer.concat([header, body])));
    socket.setTimeout(5000, () => socket.destroy(new Error("usbmuxd did not answer")));
    socket.on("error", reject);
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 4 && buf.length >= buf.readUInt32LE(0)) {
        socket.end();
        resolve(buf.subarray(16, buf.readUInt32LE(0)).toString());
      }
    });
  });
}

async function waitForIphone() {
  let told = false;
  for (;;) {
    let devices;
    try {
      devices = parseDevices(await usbmuxd({ MessageType: "ListDevices" }));
    } catch (error) {
      if (error.code === "ECONNREFUSED") {
        fail('Windows cannot talk to iPhones. Install "Apple Devices" from the Microsoft Store, open it once, and rerun.');
      }
      fail(`The Apple Mobile Device service failed: ${error.message}. Reopen the Apple Devices app and rerun.`);
    }
    if (devices[0]) return devices[0];
    if (!told) {
      console.log(
        "• Waiting for the iPhone: plug it in by USB (a data cable, not charge-only), unlock it,\n" +
          "  open the Apple Devices app, and tap Trust on the phone if it asks.",
      );
      told = true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function ensurePlumesign(home) {
  const exe = path.join(home, `plumesign-${PLUMESIGN.version}.exe`);
  if (existsSync(exe)) return exe;
  console.log(`• Downloading plumesign ${PLUMESIGN.version}…`);
  const res = await fetch(`https://github.com/claration/Impactor/releases/download/v${PLUMESIGN.version}/${PLUMESIGN.asset}`);
  if (!res.ok) fail(`plumesign download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== PLUMESIGN.sha256) fail(`plumesign checksum mismatch (${digest}); refusing to run it.`);
  writeFileSync(`${exe}.part`, bytes);
  renameSync(`${exe}.part`, exe);
  return exe;
}

function runsOf(ref, workflow) {
  return JSON.parse(
    gh(["run", "list", "--workflow", workflow, "--branch", ref, "-L", "10", "--json", "databaseId,status,conclusion"]),
  );
}

function watch(id) {
  console.log(`• Waiting for build ${id} (a native change compiles in ~20 min, anything else ~4)…`);
  return new Promise((resolve) =>
    spawn("gh", ["run", "watch", String(id), "--exit-status", "--compact", "--interval", "30"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] }).on(
      "exit",
      (code) => (code === 0 ? resolve(id) : fail(`Build ${id} failed: gh run view ${id} --log-failed`)),
    ),
  );
}

export function artifactFor(bench) {
  return bench
    ? { workflow: "ios-bench.yml", name: "murlan-ios-bench", ipa: "murlan-bench.ipa" }
    : { workflow: "ios-device.yml", name: "murlan-ios-dev", ipa: "murlan-dev.ipa" };
}

export function benchUrl(ip) {
  return `murlan://bench?host=${ip}&scenario=all`;
}

async function latestBuild(home, ref, bench) {
  const { workflow, name, ipa } = artifactFor(bench);
  const runs = runsOf(ref, workflow);
  let pick = pickRun(runs);
  if (pick?.newerFailed) {
    console.log(
      `⚠ The newest build (${pick.newerFailed}) failed; using ${pick.use}. If the failed one carried a native change,\n` +
        `  the app can crash on a missing native module: gh run view ${pick.newerFailed} --log-failed`,
    );
  }
  if (!pick) {
    const before = new Set(runs.map((r) => r.databaseId));
    console.log(`• No build of ${ref} yet: starting one.`);
    gh(["workflow", "run", workflow, "--ref", ref]);
    for (let i = 0; i < 30 && !pick?.wait; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const fresh = runsOf(ref, workflow).find((r) => !before.has(r.databaseId));
      if (fresh) pick = { wait: fresh.databaseId };
    }
    if (!pick) fail("The dispatched build never showed up in gh run list.");
  }
  const id = pick.use ?? (await watch(pick.wait));
  const buildsDir = path.join(home, "builds");
  const dir = path.join(buildsDir, String(id));
  if (!existsSync(path.join(dir, ipa))) {
    console.log(`• Downloading build ${id}…`);
    gh(["run", "download", String(id), "-n", name, "-D", dir]);
  }
  for (const old of readdirSync(buildsDir)) if (old !== String(id)) rmSync(path.join(buildsDir, old), { recursive: true, force: true });
  return { ipa: path.join(dir, ipa), fingerprint: readFileSync(path.join(dir, "fingerprint.txt"), "utf8").trim() };
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

async function login(plumesign) {
  if (!process.stdin.isTTY) fail("Signing in needs an interactive terminal: run npm run ios:device in one.");
  console.log("• Sign in with your Apple ID (free is fine). It stays saved; Apple may send a 2FA code.");
  const email = await ask("  Apple ID email: ");
  const password = await readHidden(process.stdin, process.stdout, "  Password (hidden): ");
  // The password goes over stdin, never argv, where any process of this user could read it.
  const child = spawn(plumesign, ["account", "login", "-u", email], {
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env, RUST_LOG: "info" },
  });
  child.stdin.write(`${password}\n`);
  process.stdin.pipe(child.stdin);
  process.stdin.resume();
  const code = await new Promise((resolve) => child.on("exit", resolve));
  process.stdin.unpipe(child.stdin);
  process.stdin.pause();
  if (code !== 0) fail("Apple ID sign-in failed.");
}

/** The `Error:` line plumesign exits with; its info lines ("Restoring session…") must not be read as failures. */
export function errorLine(log) {
  return log.split(/\r?\n/).findLast((l) => l.startsWith("Error:")) ?? "";
}

async function sign(plumesign, ipa) {
  // plumesign's `--udid` matches usbmuxd's DeviceID, which changes on every reconnect, so it is read at the last moment.
  const { id } = await waitForIphone();
  return new Promise((resolve) => {
    let log = "";
    const child = spawn(plumesign, ["sign", "--package", ipa, "--apple-id", "--register-and-install", "--udid", id], {
      stdio: ["inherit", "inherit", "pipe"],
      env: { ...process.env, RUST_LOG: "info" },
    });
    child.stderr.on("data", (d) => {
      log += d;
      process.stderr.write(d);
    });
    child.on("exit", (code) => resolve({ ok: code === 0, error: errorLine(log) }));
  });
}

async function install(home, plumesign, build, forceLogin) {
  const accounts = path.join(process.env.APPDATA ?? "", "PlumeImpactor", "accounts.json");
  if (forceLogin || !existsSync(accounts)) await login(plumesign);
  console.log("• Signing and installing on the iPhone…");
  let result = await sign(plumesign, build.ipa);
  if (!result.ok && /login|session|authenticat|token|No account/i.test(result.error)) {
    await login(plumesign);
    result = await sign(plumesign, build.ipa);
  }
  if (!result.ok && /pair|trust|password protected|locked/i.test(result.error)) {
    fail("The iPhone has not trusted this PC: unlock it, open the Apple Devices app, tap Trust on the phone, then rerun.");
  }
  if (!result.ok) fail("Install failed (log above). Keep the iPhone unlocked; if a free-account limit is named, delete an old sideloaded app.");
  const first = !existsSync(path.join(home, "state.json"));
  writeFileSync(path.join(home, "state.json"), JSON.stringify({ fingerprint: build.fingerprint, installedAt: Date.now() }));
  if (first) {
    console.log(
      "\n  First install, on the iPhone once:\n" +
        "   1. Settings › General › VPN & Device Management › your Apple ID › Trust.\n" +
        "   2. Settings › Privacy & Security › Developer Mode › On, restart, confirm.\n",
    );
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => (s.end(), resolve(true)));
    s.on("error", () => resolve(false));
  });
}

function killTree(child) {
  if (child.pid && child.exitCode === null) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
}

export function metroEnv(env, ip, diagnostics) {
  return {
    ...env,
    EXPO_PUBLIC_DOMAIN: `http://${ip}:${SERVER_PORT}`,
    REACT_NATIVE_PACKAGER_HOSTNAME: ip,
    ...(diagnostics ? { EXPO_PUBLIC_DIAGNOSTICS: "1" } : {}),
  };
}

function benchServe() {
  const ip = lanAddress(os.networkInterfaces());
  if (!ip) fail("No Wi-Fi/LAN address on this PC; the phone must share a network with it.");
  const collector = spawn(process.execPath, [path.join(ROOT, "scripts", "diagnostics-collector.mjs")], { cwd: ROOT, stdio: "inherit" });
  process.on("exit", () => killTree(collector));
  console.log(`• Bench build installed. On the iPhone open ${benchUrl(ip)} and leave it face up; results land in diagnostics/.`);
}

async function serve(home, diagnostics) {
  const ip = lanAddress(os.networkInterfaces());
  if (!ip) fail("No Wi-Fi/LAN address on this PC; the phone must share a network with it.");
  let server;
  if (await portOpen(SERVER_PORT)) {
    console.log(`• Game server already running on :${SERVER_PORT}; using it.`);
  } else {
    const logFile = path.join(home, "server.log");
    console.log(`• Starting the game server on :${SERVER_PORT} (Docker Postgres; log: ${logFile})…`);
    const out = openSync(logFile, "w");
    server = spawn(process.execPath, [path.join(ROOT, "scripts", "e2e-server.mjs"), "--play"], {
      cwd: ROOT,
      stdio: ["ignore", out, out],
      env: { ...process.env, E2E_SKIP_BUILD: "1" },
    });
    const exited = new Promise((resolve) => server.on("exit", (code, signal) => resolve(code ?? signal)));
    process.on("exit", () => killTree(server));
    process.on("SIGINT", () => process.exit(130));
    while (!(await portOpen(SERVER_PORT))) {
      const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r(null), 2000))]);
      if (code !== null) fail(`The game server exited (${code}) before it came up; see ${logFile}.`);
    }
    exited.then((code) => console.error(`\n✖ The game server stopped (${code}); online play is down. See ${logFile}.`));
    console.log("• Game server up.");
  }
  console.log(`• Metro for the dev build at http://${ip}:8081. First time: scan the QR code with the iPhone camera.\n`);
  // Production JS, as a player runs it: dev-mode JS drops the table well under 60 fps.
  if (diagnostics) {
    const collector = spawn(process.execPath, [path.join(ROOT, "scripts", "diagnostics-collector.mjs")], { cwd: ROOT, stdio: "inherit" });
    process.on("exit", () => killTree(collector));
    console.log(`• Diagnostics build: once the app loads, open murlan://bench?host=${ip}&scenario=all on the phone.`);
  }
  const metro = spawn("npx expo start --dev-client --lan --no-dev --minify", {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
    env: metroEnv(process.env, ip, diagnostics),
  });
  metro.on("exit", (code) => process.exit(code ?? 0));
}

async function main() {
  if (process.platform !== "win32") fail("Windows only: the pinned plumesign is the Windows x64 build.");
  const args = process.argv.slice(2);
  const refAt = args.indexOf("--ref");
  const ref = refAt === -1 ? "main" : args[refAt + 1];
  try {
    createRequire(path.join(ROOT, "package.json")).resolve("expo-dev-client/package.json");
  } catch {
    console.log("• Installing dependencies (expo-dev-client is missing)…");
    if (spawnSync("npm install", { cwd: ROOT, stdio: "inherit", shell: true }).status !== 0) fail("npm install failed.");
  }
  const home = path.join(process.env.LOCALAPPDATA ?? os.homedir(), "murlan-ios");
  mkdirSync(path.join(home, "builds"), { recursive: true });

  const bench = args.includes("--bench");
  const [plumesign, build] = await Promise.all([ensurePlumesign(home), latestBuild(home, ref, bench)]);
  const statePath = path.join(home, "state.json");
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
  if (args.includes("--reinstall") || args.includes("--login") || needsInstall(state, { fingerprint: build.fingerprint, now: Date.now() })) {
    await install(home, plumesign, build, args.includes("--login"));
  } else {
    console.log(`• The installed build is current (signed ${((Date.now() - state.installedAt) / 86400000).toFixed(1)} days ago).`);
  }
  if (bench) benchServe();
  else await serve(home, args.includes("--diagnostics"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
