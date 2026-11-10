// RULES.md 48: the native CI setup is written once, in tools/ci/*.sh, and every workflow and
// composite action calls it. A copy in a workflow is one a pin bump reaches in only some of the places.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETUP = [
  { script: "tools/ci/pin-ndk.sh", copy: /ndkVersion|\$ANDROID_HOME\/ndk/ },
  { script: "tools/ci/enable-kvm.sh", copy: /99-kvm4all|udevadm/ },
  { script: "tools/ci/install-maestro.sh", copy: /MAESTRO_VERSION|get\.maestro\.mobile\.dev/ },
];

const yamls = (): string[] => [
  ...readdirSync(path.join(root, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f)).map((f) => `.github/workflows/${f}`),
  ...readdirSync(path.join(root, ".github/actions")).map((d) => `.github/actions/${d}/action.yml`),
];

/** The files that spell out a step a script in SETUP already holds. */
function copies(files: Record<string, string>): string[] {
  const code = (text: string) => text.replace(/^[ \t]*#.*$/gm, "");
  return SETUP.flatMap(({ script, copy }) =>
    Object.entries(files).filter(([, text]) => copy.test(code(text))).map(([file]) => `${file} carries its own copy of what ${script} does`)
  );
}

const real = () => Object.fromEntries(yamls().map((f) => [f, readFileSync(path.join(root, f), "utf8")]));

test("no workflow or action spells out the native setup a script holds", () => {
  assert.deepEqual(copies(real()), []);
});

test("every script is called from somewhere", () => {
  const all = Object.values(real()).join("\n");
  for (const { script } of SETUP) assert.ok(all.includes(script), `${script} is called by no workflow`);
});

test("a workflow that writes the NDK derivation, the KVM rule or the Maestro pin itself fails", () => {
  const files = {
    "a.yml": "run: sed -i \"1i ext.ndkVersion = 1\" android/build.gradle",
    "b.yml": "run: sudo udevadm trigger --name-match=kvm",
    "c.yml": "run: export MAESTRO_VERSION=2.10.0",
  };
  assert.equal(copies(files).length, 3);
});
