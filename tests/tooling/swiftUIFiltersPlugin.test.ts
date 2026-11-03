import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { insertSwiftUIFilters, patchedAppDelegate, podOf, templateIosFile } from "../helpers/appDelegate.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FLAGS = path.join(repoRoot, "modules/murlan-rn-patches/ios/MurlanReactNativeFlags.mm");
const SCENE_DELEGATE = path.join(path.dirname(createRequire(import.meta.url).resolve("expo/package.json")), "ios/Expo/ExpoAppSceneDelegate.swift");

test("the installed Expo template's AppDelegate turns the SwiftUI filters on after creating the factory, before launch returns", () => {
  const out = patchedAppDelegate();
  const at = (s: string) => out.indexOf(s);
  // Expo's generated module provider imports every module `internal`, and Swift refuses two levels.
  assert.ok(at(`\ninternal import ${podOf(FLAGS).name}\n`) > at("import React"), "imports the pod at the provider's access level");
  const call = at("MurlanReactNativeFlags.enableSwiftUIFilters()");
  assert.ok(call > at("ExpoReactNativeFactory(delegate:"), "after the factory sets its release level");
  assert.ok(call < at("return super.application(application, didFinishLaunchingWithOptions:"), "inside didFinishLaunching, before any scene connects");
  assert.equal(at("startReactNative("), -1, "the AppDelegate starts React Native itself, so the call must precede that start");
  assert.equal(insertSwiftUIFilters(out), out, "a second prebuild pass adds nothing");
});

test("a template without the anchor fails the prebuild instead of shipping without the flag", () => {
  assert.throws(() => insertSwiftUIFilters("import React\nlet factory = Something()\n"), /AppDelegate template changed/);
});

test("React Native starts only once a scene connects, which UIKit does after didFinishLaunching returns", () => {
  assert.match(templateIosFile("SceneDelegate.swift"), /class SceneDelegate: ExpoAppSceneDelegate \{/);
  const scene = readFileSync(SCENE_DELEGATE, "utf8");
  const connect = scene.indexOf("willConnectTo session: UISceneSession");
  const start = scene.indexOf("factory.startReactNative(");
  assert.ok(connect > 0 && start > connect, "ExpoAppSceneDelegate no longer starts React Native in scene(_:willConnectTo:options:)");
  assert.equal(scene.split("startReactNative(").length, 2, "ExpoAppSceneDelegate starts React Native somewhere else too");
});
