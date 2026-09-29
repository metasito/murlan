import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const plugin = createRequire(import.meta.url)("../../modules/murlan-diagnostics/app.plugin.js") as (c: object) => { mods?: { android?: Record<string, unknown>; ios?: Record<string, unknown> } };

test("cleartext traffic and the microphone prompt are added to a diagnostics prebuild and never to any other", () => {
  const config = { name: "murlan", slug: "murlan" };
  delete process.env.EXPO_PUBLIC_DIAGNOSTICS;
  assert.equal(plugin(config), config);
  process.env.EXPO_PUBLIC_DIAGNOSTICS = "1";
  const flagged = plugin({ ...config });
  assert.equal(typeof flagged.mods?.android?.manifest, "function");
  assert.equal(typeof flagged.mods?.ios?.infoPlist, "function");
  delete process.env.EXPO_PUBLIC_DIAGNOSTICS;
});
