import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { errorLine, hashTree, lanAddress, needsInstall, parseDevices, pickRun, readHidden } from "../../scripts/ios-device.mjs";

const DAY = 24 * 60 * 60 * 1000;

test("reinstalls only on a first run, a changed build, or a certificate near its 7-day expiry", () => {
  const state = { build: "b1", installedAt: 0 };
  assert.equal(needsInstall(null, { build: "b1", now: 0 }), true);
  assert.equal(needsInstall(state, { build: "b1", now: 5 * DAY }), false);
  assert.equal(needsInstall(state, { build: "b2", now: DAY }), true);
  assert.equal(needsInstall(state, { build: "b1", now: 6 * DAY + 1 }), true);
});

test("the bundle hash moves with a file's bytes, its path, and an added file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ios-hash-"));
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "main.jsbundle"), "a");
  writeFileSync(path.join(dir, "assets", "x.png"), "b");
  const first = hashTree(dir);
  assert.equal(hashTree(dir), first);
  writeFileSync(path.join(dir, "assets", "x.png"), "c");
  const edited = hashTree(dir);
  assert.notEqual(edited, first);
  renameSync(path.join(dir, "assets", "x.png"), path.join(dir, "assets", "y.png"));
  assert.notEqual(hashTree(dir), edited);
  writeFileSync(path.join(dir, "assets", "z.png"), "");
  assert.notEqual(hashTree(dir), edited);
  rmSync(dir, { recursive: true, force: true });
});

test("the LAN address skips virtual adapters and public addresses", () => {
  const v4 = (address: string, internal = false) => ({ address, family: "IPv4", internal });
  assert.equal(
    lanAddress({
      "vEthernet (WSL)": [v4("172.20.0.1")],
      "Loopback Pseudo-Interface 1": [v4("127.0.0.1", true)],
      Ethernet: [v4("8.8.8.8")],
      "Wi-Fi": [{ address: "fe80::1", family: "IPv6", internal: false }, v4("192.168.1.23")],
    }),
    "192.168.1.23",
  );
  assert.equal(lanAddress({ "vEthernet (Default Switch)": [v4("172.30.0.1")] }), null);
});

test("usbmuxd's device list yields each UDID, USB before Wi-Fi", () => {
  const device = (type: string, id: number, udid: string) =>
    `<dict><key>DeviceID</key><integer>${id}</integer><key>MessageType</key><string>Attached</string><key>Properties</key><dict><key>ConnectionType</key><string>${type}</string><key>DeviceID</key><integer>${id}</integer><key>LocationID</key><integer>0</integer><key>SerialNumber</key><string>${udid}</string></dict></dict>`;
  const xml = `<plist><dict><key>DeviceList</key><array>${device("Network", 12, "WIFI")}${device("USB", 397, "CABLE")}</array></dict></plist>`;
  assert.deepEqual(
    parseDevices(xml).map((d: { udid: string; id: string }) => [d.udid, d.id]),
    [["CABLE", "397"], ["WIFI", "12"]],
  );
  assert.deepEqual(parseDevices("<plist><dict><key>DeviceList</key><array/></dict></plist>"), []);
});

test("only plumesign's closing Error: line counts as the failure", () => {
  const log = "[INFO plumesign::commands::account] Restoring session for a@b.c...\nError: Other error: Device ID 397 not found\n";
  assert.equal(errorLine(log), "Error: Other error: Device ID 397 not found");
  assert.equal(errorLine("[INFO] Restoring session for a@b.c...\n"), "");
});

test("a running build is waited for; otherwise the newest green one is used", () => {
  const run = (databaseId: number, status: string, conclusion = "") => ({ databaseId, status, conclusion });
  assert.deepEqual(pickRun([run(3, "in_progress"), run(2, "completed", "success")]), { wait: 3 });
  assert.deepEqual(pickRun([run(2, "completed", "success"), run(1, "completed", "success")]), { use: 2 });
  assert.deepEqual(pickRun([run(3, "completed", "failure"), run(2, "completed", "success")]), { use: 2, newerFailed: 3 });
  assert.equal(pickRun([run(3, "completed", "failure")]), null);
  assert.equal(pickRun([]), null);
});

test("the password prompt never echoes what is typed, even while editing it", async () => {
  const input = Object.assign(new PassThrough(), { setRawMode: () => {} });
  let shown = "";
  const output = new Writable({ write: (chunk, _enc, done) => ((shown += chunk), done()) });
  const answer = readHidden(input, output, "Password: ");
  input.write("secrex\u007f");
  input.write("t\r");
  assert.equal(await answer, "secret");
  assert.equal(shown, "Password: \n");
});
