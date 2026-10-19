// The one registry of forbidden-shape rules. Where a new one goes, and the floor every guard stands
// on, is docs/agents/checks.md § Where a forbidden-shape rule goes.

/**
 * @typedef {object} Guard
 * @property {string} id Rule id under the plugin: `murlan/${id}`.
 * @property {string} why Reported at the site: the owner module or doc, and what to do instead.
 * @property {string} selector esquery over the AST, several shapes joined with ", "; never raw text.
 * @property {string[]} files Flat-config globs the guard applies to.
 * @property {{ glob: string, reason: string }[]} [ignores] The only exemption form.
 * @property {{ file: string, code: string, hits: number }} plant Fires exactly `hits` times, linted as `file`.
 * @property {{ file: string, code: string }[]} spare Shapes the guard must not catch.
 */

const CLIENT = ["{app,components,context,lib,locales,modules,shared}/**/*.{ts,tsx}"];
const SCREENS = ["{app,components,context,lib}/**/*.{ts,tsx}"];
const DRAWN = ["{app,components}/**/*.tsx"];
const TEST_RUNNERS = "/^(it|test|describe|suite)$/";
const SEAT_IDENTITY = "/^(viewerSeat|mySeatIndex)$/";
const AUDIO_LAYERED = ["{app,components,context,lib,modules}/**/*.{ts,tsx}"];
// esquery's regex literal ends at its first slash, so a path separator is written \x2F.
// With `values`, a declaration whose every specifier is `type` is spared: it never reaches the bundle.
const importsOf = (source, { values = false } = {}) =>
  [
    `ImportDeclaration${values ? ':not([importKind="type"]):matches([specifiers.length=0], :has(ImportSpecifier[importKind="value"]), :has(ImportDefaultSpecifier), :has(ImportNamespaceSpecifier))' : ""}[source.value=${source}]`,
    `ExportNamedDeclaration${values ? ':not([exportKind="type"]):has(ExportSpecifier[exportKind="value"])' : ""}[source.value=${source}]`,
    `ExportAllDeclaration${values ? ':not([exportKind="type"])' : ""}[source.value=${source}]`,
    `ImportExpression[source.value=${source}]`,
    `CallExpression[callee.name="require"][arguments.0.value=${source}]`,
  ].join(", ");

/** @type {readonly Guard[]} */
const GUARDS = [
  {
    id: "no-focused-test",
    why: "A focused test makes jest skip the rest of its file and Playwright the rest of its shard, green either way: drop the `.only` (tests/e2e/playwright.config.ts forbids one on CI alone).",
    selector: [
      `MemberExpression[property.name="only"]:matches([object.name=${TEST_RUNNERS}], [object.object.name=${TEST_RUNNERS}], [object.object.object.name=${TEST_RUNNERS}])`,
      "CallExpression[callee.name=/^f(it|describe)$/]",
      'CallExpression > ObjectExpression > Property[key.name="only"][value.value=true]',
    ].join(", "),
    files: ["tests/**/*.{ts,tsx,mjs}", "tools/loop/tests/**/*.{ts,mjs}"],
    plant: { file: "tests/ui-rules/plant.test.ts", code: [
      'it.only("x", () => {});',
      'test.describe.only("y", () => {});',
      'fit("x", () => {});',
      'fdescribe("y", () => {});',
      'test("z", { only: true }, () => {});',
      'it.only.each([1])("x %s", () => {});',
      'test.only.each([1])("x %s", () => {});',
      'describe.only.each([1])("y %s", () => {});',
      'test.describe.parallel.only("y", () => {});',
    ].join("\n"), hits: 9 },
    spare: ['// it.only("x")\nconst profit = 1; benefit(2); onlyOnce(); split(".only(");', 'test("z", { only: false }, () => {});', "cache.only.each(x);"].map((code) => ({ file: "tests/ui-rules/plant.test.ts", code })),
  },
  {
    id: "intents-through-send",
    why: "A bare `emit` is at-most-once and carries no intentId, so its loss is silent and its retry is a second intent: send it through `send()` in lib/sendIntent.ts.",
    selector:
      'CallExpression[callee.property.name="emit"]:matches([arguments.0.value=/^(room|game):/], [arguments.0.quasis.0.value.raw=/^(room|game):/])',
    files: CLIENT,
    plant: { file: "context/Plant.tsx", code: ['socket?.emit("room:leave");', "socket.emit(`game:play`, { cards });", 'socket.emit(\n  "room:join",\n  code\n);'].join("\n"), hits: 3 },
    spare: ['socket.emit("connect_error");', 'send(socket, "room:leave", {});', 'emitter.on("room:leave", f);', '// socket.emit("room:leave")\nconst s = \'emit("room:leave")\';'].map((code) => ({ file: "context/Plant.tsx", code })),
  },
  {
    id: "spring-tokens",
    why: "This declares a spring instead of naming one, so the design system cannot reach it: use Motion.spring.* from lib/tokens.ts, and if none fits, the design wants a new one.",
    selector: "ObjectExpression > Property:matches([key.name=/^damping(Ratio)?$/], [key.value=/^damping(Ratio)?$/])",
    files: SCREENS,
    ignores: [{ glob: "lib/tokens.ts", reason: "the tokens are where a spring is declared" }],
    plant: { file: "components/Plant.tsx", code: ["const s = { damping: D, stiffness: 200 };", "withSpring(1, { dampingRatio: 0.4 });", 'const s = { "damping": 12 };'].join("\n"), hits: 3 },
    spare: ["const s = { stiffness: 200 };", "type Spring = { damping: number };", "const { damping } = Motion.spring.land;", '// damping: 12\nconst s = "damping";'].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "field-not-random",
    why: "The home screen's drifting cards are a fixed composition (components/homeCardField.ts), so no part of it is drawn at random.",
    selector: 'CallExpression[callee.object.name="Math"][callee.property.name="random"]',
    files: ["app/index.tsx", "components/homeCardField.ts"],
    plant: { file: "app/index.tsx", code: "const x = Math.random() * 10;", hits: 1 },
    spare: ["const x = restingPose(card).rise;", "const random = 1; const y = rng.random();"].map((code) => ({ file: "app/index.tsx", code })),
  },
  {
    id: "seat-identity",
    why: "A watcher's seat answers yes to this: ask `viewerOwnsSeat(seat, viewerSeat, spectating)` from components/seatLayout.ts instead of comparing by hand.",
    selector: `BinaryExpression[operator="==="]:matches([left.name=${SEAT_IDENTITY}], [right.name=${SEAT_IDENTITY}], [left.property.name=${SEAT_IDENTITY}], [right.property.name=${SEAT_IDENTITY}]):not([left.raw="null"], [right.raw="null"])`,
    files: ["components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    ignores: [
      { glob: "components/seatLayout.ts", reason: "viewerOwnsSeat is the one comparison the rest ask" },
      { glob: "components/flightPhysics.ts", reason: "handed a seat GameTable already nulled for a watcher, so a raw comparison answers no for one" },
      { glob: "components/table/ExchangeLegs.tsx", reason: "handed a seat GameTable already nulled for a watcher, so a raw comparison answers no for one" },
    ],
    plant: { file: "components/table/Plant.tsx", code: ["const mine = seat === viewerSeat;", "if (mySeatIndex === p.seat) go();", "const me = state.viewerSeat === seat;"].join("\n"), hits: 3 },
    spare: [
      "const others = players.filter((p) => p.seat !== viewerSeat);",
      "const mine = viewerOwnsSeat(seat, viewerSeat, spectating);",
      "const spectating = viewerSeat === null;",
    ].map((code) => ({ file: "components/table/Plant.tsx", code })),
  },
  {
    id: "one-modal",
    why: "components/AppModal.tsx is the only <Modal>, react-native's or any module's, under any name: render <AppModal>, since a second <Modal> is a second place to get supportedOrientations, statusBarTranslucent and onRequestClose wrong.",
    selector: [
      'ImportSpecifier[imported.name="Modal"]',
      'ImportDefaultSpecifier[local.name="Modal"]',
      'JSXOpeningElement[name.name="Modal"]',
      'ExportNamedDeclaration[source.value="react-native"] > ExportSpecifier[local.name="Modal"]',
      'MemberExpression[property.name="Modal"]',
      'MemberExpression[property.value="Modal"]',
      'JSXMemberExpression[property.name="Modal"]',
      'VariableDeclarator > ObjectPattern > Property[key.name="Modal"]',
    ].join(", "),
    files: SCREENS,
    ignores: [{ glob: "components/AppModal.tsx", reason: "the one shell every modal renders through" }],
    plant: { file: "components/Plant.tsx", code: [
      'import { View, Modal as Sheet } from "react-native";',
      'import * as RN from "react-native";',
      "const x = <RN.Modal visible />;",
      "const y = RN.Modal;",
      'export { Modal } from "react-native";',
      'import {\n  Text,\n  Modal,\n} from "react-native";',
      "const { View, Modal: M } = N;",
      'const Sheet = B["Modal"];',
      'import { Modal as Other } from "./Modal";',
      'import Modal from "react-native-modal";',
      "const z = <Modal isVisible />;",
    ].join("\n"), hits: 10 },
    spare: [
      'import { type ModalProps, Pressable } from "react-native";',
      'import * as Unused from "react-native";',
      'import { ModalStack } from "./stack";',
      "const x = <ModalFoo />;",
      "const x = <AppModal visible />;",
      "const x = <RN.ModalFoo />;",
      '// <Modal> from "react-native"\nconst s = "Modal";',
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "modal-keeps-landscape",
    why: "React Native's <Modal> defaults to portrait on iOS, so opening one in landscape rotates the app and every tap lands on nothing: declare supportedOrientations including landscape, once, in components/AppModal.tsx.",
    selector:
      'JSXOpeningElement[name.name="Modal"]:not(:has(JSXAttribute[name.name="supportedOrientations"] Literal[value="landscape"]))',
    files: DRAWN,
    plant: { file: "components/Plant.tsx", code: ["const x = <Modal visible />;", 'const x = <Modal supportedOrientations={["portrait"]} />;'].join("\n"), hits: 2 },
    spare: ['const x = <Modal supportedOrientations={["portrait", "landscape"]} />;', "const x = <AppModal visible />;"].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "landscape-only",
    why: "Only the game table forces an orientation (components/GameTable.tsx): it is the one screen that needs the width.",
    selector: "Identifier[name=/^lock\\w*Async$/]",
    files: SCREENS,
    ignores: [{ glob: "components/GameTable.tsx", reason: "the one screen that needs the width" }],
    plant: { file: "components/Plant.tsx", code: ["ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);", 'import { lockPlatformAsync } from "expo-screen-orientation";'].join("\n"), hits: 3 },
    spare: ["ScreenOrientation.unlockAsync();", "const locked = true;", '// lockAsync\nconst s = "lockAsync";'].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "no-portrait-lock",
    why: "Nothing may lock the player into portrait: one held in landscape would be yanked round behind their back, and components/GameTable.tsx locks landscape alone.",
    selector: 'MemberExpression[property.name=/^PORTRAIT/]:matches([object.name="OrientationLock"], [object.property.name="OrientationLock"])',
    files: SCREENS,
    plant: { file: "components/Plant.tsx", code: ["lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);", "lockAsync(OrientationLock.PORTRAIT_UP);"].join("\n"), hits: 2 },
    spare: ["lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);", "const PORTRAIT = 1;"].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "screens-unconditional",
    why: "expo-router hands a falsy child to the navigator, which logs \"Layout children must be of type Screen\" on every render: guard the route with <Stack.Protected guard={…}>, as app/_layout.tsx does.",
    selector: 'JSXExpressionContainer :matches(LogicalExpression, ConditionalExpression) JSXElement[openingElement.name.property.name="Screen"]',
    files: ["app/**/_layout.tsx"],
    plant: { file: "app/_layout.tsx", code: ['const x = <Stack>{__DEV__ && <Stack.Screen name="capture" />}</Stack>;', 'const x = <Tabs>{ready ? <Tabs.Screen name="x" /> : null}</Tabs>;'].join("\n"), hits: 2 },
    spare: [
      'const x = <Stack><Stack.Screen name="index" /></Stack>;',
      'const x = <Stack><Stack.Protected guard={ok}><Stack.Screen name="capture" /></Stack.Protected></Stack>;',
    ].map((code) => ({ file: "app/_layout.tsx", code })),
  },
  {
    id: "no-run-on-js",
    why: "runOnJS is deprecated in react-native-worklets and a future major removes it, silently stopping every animation that schedules back: import scheduleOnRN from react-native-worklets and call scheduleOnRN(fn, ...args), as components/NotificationBanner.tsx does.",
    selector: ['ImportSpecifier[imported.name="runOnJS"]', 'MemberExpression[property.name="runOnJS"]', 'CallExpression[callee.name="runOnJS"]'].join(", "),
    files: SCREENS,
    plant: { file: "components/Plant.tsx", code: ['import { runOnJS } from "react-native-reanimated";', "runOnJS(done)();", "Reanimated.runOnJS(done)();"].join("\n"), hits: 3 },
    spare: [{ file: "components/Plant.tsx", code: '// runOnJS was the old way\nconst s = "runOnJS";\nscheduleOnRN(done);' }],
  },
  {
    id: "table-text",
    why: "React Native multiplies every fontSize by the OS text setting, up to ~3.1x, and the table is fixed boxes that do not grow: render components/table/TableText.tsx, which holds the cap, instead of a bare Text.",
    selector: [
      'ImportDeclaration[source.value="react-native"] > ImportSpecifier[imported.name="Text"]',
      'JSXOpeningElement[name.name="Text"]',
      'JSXOpeningElement[name.object.name="Animated"][name.property.name="Text"]',
    ].join(", "),
    files: ["components/table/**/*.tsx", "components/CardView.tsx", "components/GameTable.tsx"],
    ignores: [{ glob: "components/table/TableText.tsx", reason: "the one Text that carries the cap" }],
    plant: { file: "components/table/Plant.tsx", code: [
      'import { View, Text } from "react-native";',
      "const a = <Text style={styles.rankText}>x</Text>;",
      "const b = <Text maxFontSizeMultiplier={1.2} style={styles.x}>x</Text>;",
      "const c = <Animated.Text style={s}>x</Animated.Text>;",
    ].join("\n"), hits: 4 },
    spare: [
      "const a = <TableText style={styles.x}>x</TableText>;",
      "const b = <TextInput value={v} />;",
      '// a bare <Text> grows\nconst s = "<Text>";',
    ].map((code) => ({ file: "components/table/Plant.tsx", code })),
  },
  {
    id: "query-cache-owner",
    why: "The cached lists belong to one account and their keys do not say whose, so emptying them is the sign-out's alone (context/SocketContext.tsx): a second clear, remove or reset is a second owner of when the cache is valid.",
    selector: [
      "CallExpression[callee.property.name=/^(removeQueries|resetQueries)$/]",
      // A Set or Map its module owns, by name: lastVoice (lib/device/audioEngine.ts),
      // reportedSignatures (lib/errorReporting.ts), timers (lib/reactions.ts).
      'CallExpression[callee.property.name="clear"][arguments.length=0]:not([callee.object.name=/^(lastVoice|reportedSignatures|timers)$/])',
    ].join(", "),
    files: SCREENS,
    ignores: [{ glob: "context/SocketContext.tsx", reason: "the sign-out, which empties the query cache" }],
    plant: { file: "lib/errorReporting.ts", code: [
      "queryClient.clear();",
      "qc.clear ();",
      'queryClient.removeQueries({ queryKey: ["/api/friends"] });',
      "queryClient.resetQueries();",
    ].join("\n"), hits: 4 },
    spare: ['url.searchParams.clear("x");', "reportedSignatures.clear();", "queryClient.invalidateQueries();", '// qc.clear()\nconst s = "qc.clear()";'].map((code) => ({ file: "lib/errorReporting.ts", code })),
  },
  {
    id: "no-cwd-root",
    why: "The cwd is wherever the run was started, so a root read from it points somewhere else under another runner: take the root from the file's own path, as tests/tooling/lintGuards.test.ts does.",
    selector: 'CallExpression[callee.object.name="process"][callee.property.name="cwd"]',
    files: ["tests/**/*.{ts,tsx,js,mjs,cjs}"],
    ignores: [
      { glob: "tests/tooling/entry.test.ts", reason: "isInvokedDirectly resolves a relative argv1 against the cwd, which is the case it pins" },
      { glob: "tests/helpers/filesRunReporter.mjs", reason: "a reporter names files relative to where the run was started" },
      { glob: "tests/server/sourceMaps.test.ts", reason: "symbolicate resolves its root against the cwd, as production does, which the default- and relative-root cases pin" },
    ],
    plant: { file: "tests/server/plant.test.ts", code: ['const root = path.resolve(process.cwd(), "sourcemaps");', "const home = process.cwd();"].join("\n"), hits: 2 },
    spare: [{ file: "tests/server/plant.test.ts", code: '// process.cwd() is wherever the run started\nconst s = "process.cwd()";\nconst root = path.resolve(import.meta.dirname, "..", "..");' }],
  },
  {
    id: "audio-engine-owner",
    why: "ADR-0009 (docs/adr/0009-audio-and-haptics-libraries.md) gives react-native-audio-api and the audio-session module one owner, lib/device/audioEngine.ts: play through lib/device/feedback.ts.",
    selector: importsOf("/^react-native-audio-api(\\x2F|$)|(^|\\x2F)murlan-audio-session(\\x2F|$)/", { values: true }),
    files: AUDIO_LAYERED,
    ignores: [{ glob: "lib/device/audioEngine.ts", reason: "the owner of the audio engine" }],
    plant: { file: "components/Plant.tsx", code: [
      'import { AudioContext } from "react-native-audio-api";',
      'import { type AudioBuffer, AudioContext as Ctx } from "react-native-audio-api";',
      'import "react-native-audio-api";',
      'export { AudioContext } from "react-native-audio-api";',
      'export * from "react-native-audio-api";',
      'const api = import("react-native-audio-api");',
      'const m = require("react-native-audio-api");',
      'import { setCategory } from "../modules/murlan-audio-session";',
      'import Session from "@/modules/murlan-audio-session/index.ts";',
    ].join("\n"), hits: 9 },
    spare: [
      'import type { AudioContext } from "react-native-audio-api";',
      'import { type AudioContext, type AudioBuffer } from "react-native-audio-api";',
      'export { type AudioContext } from "react-native-audio-api";',
      'export type * from "react-native-audio-api";',
      'import { x } from "react-native-audio-api-shim";',
      '// import "react-native-audio-api"\nconst s = "react-native-audio-api";',
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "haptics-engine-owner",
    why: "ADR-0009 (docs/adr/0009-audio-and-haptics-libraries.md) gives react-native-turbo-haptics one owner, lib/device/hapticsEngine.ts: buzz through lib/device/feedback.ts.",
    selector: importsOf("/^react-native-turbo-haptics(\\x2F|$)/", { values: true }),
    files: AUDIO_LAYERED,
    ignores: [{ glob: "lib/device/hapticsEngine.ts", reason: "the owner of the haptics engine" }],
    plant: { file: "modules/murlan-orientation/plant.ts", code: [
      'import { trigger } from "react-native-turbo-haptics";',
      'export { trigger } from "react-native-turbo-haptics";',
      'const h = import("react-native-turbo-haptics");',
    ].join("\n"), hits: 3 },
    spare: ['import type { HapticType } from "react-native-turbo-haptics";'].map((code) => ({ file: "modules/murlan-orientation/plant.ts", code })),
  },
  {
    id: "no-expo-audio",
    why: "ADR-0009 (docs/adr/0009-audio-and-haptics-libraries.md) chose react-native-audio-api and react-native-turbo-haptics over expo-audio and expo-haptics, so neither has an owner: play through lib/device/feedback.ts.",
    selector: importsOf("/^expo-(audio|haptics)(\\x2F|$)/", { values: true }),
    files: AUDIO_LAYERED,
    plant: { file: "context/Plant.tsx", code: [
      'import * as Haptics from "expo-haptics";',
      'import { useAudioPlayer } from "expo-audio";',
      'const a = require("expo-audio");',
    ].join("\n"), hits: 3 },
    spare: ['import type { AudioPlayer } from "expo-audio";', 'import { Image } from "expo-image";'].map((code) => ({ file: "context/Plant.tsx", code })),
  },
  {
    id: "diagnostics-owner",
    why: "ADR-0009 (docs/adr/0009-audio-and-haptics-libraries.md) layers the native modules: the diagnostics module has one reader, lib/diagnostics/probe.ts, and the rest ask it.",
    selector: importsOf("/(^|\\x2F)murlan-diagnostics(\\x2F|$)/", { values: true }),
    files: AUDIO_LAYERED,
    ignores: [{ glob: "lib/diagnostics/probe.ts", reason: "the one reader of the diagnostics module" }],
    plant: { file: "app/Plant.tsx", code: [
      'import { probe } from "@/modules/murlan-diagnostics";',
      'const d = import("../modules/murlan-diagnostics/index.ts");',
    ].join("\n"), hits: 2 },
    spare: ['import type { Probe } from "@/modules/murlan-diagnostics";', 'import { probe } from "@/lib/diagnostics/probe";'].map((code) => ({ file: "app/Plant.tsx", code })),
  },
  {
    id: "animation-callback-takes-finished",
    why: "A completion callback that ignores `finished` runs its follow-up on an animation that was cancelled, and `withRepeat(x, 0)` repeats forever: take `(finished)` and act only when it is true, as the sweep in components/table/pile.tsx does, and arm a repeat only for a count of at least 1.",
    selector: [
      'CallExpression[callee.name=/^(withTiming|withSpring|withDecay|withRepeat)$/] > :matches(ArrowFunctionExpression, FunctionExpression):matches([params.length=0], [params.0.name=/^_/])',
      'CallExpression[callee.name="withRepeat"][arguments.1.value=0]',
    ].join(", "),
    files: SCREENS,
    plant: { file: "components/Plant.tsx", code: [
      "a.value = withTiming(1, { duration: 1 }, () => go());",
      "a.value = withSpring(1, {}, function () { go(); });",
      "a.value = withDecay({ velocity: 1 }, (_finished) => go());",
      "a.value = withRepeat(b, 2, false, () => go());",
      "a.value = withRepeat(b, 0);",
    ].join("\n"), hits: 5 },
    spare: [
      "a.value = withTiming(1, { duration: 1 }, (finished) => { if (finished) go(); });",
      "a.value = withRepeat(b, 2, false, (finished) => { if (finished) go(); });",
      "a.value = withRepeat(b, -1);",
      "setTimeout(() => go(), 10);",
      "const leg = (to) => withTiming(to, { duration: 1 });",
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "feedback-owner",
    why: "ADR-0009 (docs/adr/0009-audio-and-haptics-libraries.md) puts both engines behind one owner, lib/device/feedback.ts: play and buzz through it.",
    selector: importsOf("/(^|\\x2F)(audioEngine|hapticsEngine)(\\.ts)?$/", { values: true }),
    files: AUDIO_LAYERED,
    ignores: [{ glob: "lib/device/feedback.ts", reason: "the one owner of both engines" }],
    plant: { file: "components/Plant.tsx", code: [
      'import { play } from "@/lib/device/audioEngine";',
      'import { play } from "../lib/device/audioEngine.ts";',
      'import { buzz } from "./device/hapticsEngine.ts";',
      'const e = import("@/lib/device/audioEngine");',
      'const h = require("../lib/device/hapticsEngine");',
    ].join("\n"), hits: 5 },
    spare: [
      'import type { Bus } from "@/lib/device/audioEngine";',
      'import { playSound } from "@/lib/device/feedback";',
      'import { x } from "./audioEngineTiming";',
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "shared-no-client",
    why: "shared/ is what the server and the client both read, so it may import the domain (lib/game/) and never a client module: take TranslationKey from shared/i18n.ts, and move a type both sides need into shared/.",
    selector: importsOf("/(^|\\x2F)(app|components|context)\\x2F|(^|\\x2F)lib\\x2F(?!game\\x2F)/"),
    files: ["shared/**/*.{ts,tsx}"],
    plant: { file: "shared/plant.ts", code: [
      'import type { TranslationKey } from "../lib/i18n";',
      'import { t } from "@/lib/i18n";',
      'export type { RoundHistoryDto } from "../lib/wire.ts";',
      'import type { Auth } from "../context/AuthContext";',
    ].join("\n"), hits: 4 },
    spare: [
      'import type { Card } from "../lib/game/gameEngine.ts";',
      'import { en } from "../locales/en.ts";',
      'import type { TranslationParams } from "./i18n.ts";',
      '// import "../lib/i18n"\nconst s = "../lib/i18n";',
    ].map((code) => ({ file: "shared/plant.ts", code })),
  },
  {
    id: "game-no-client-i18n",
    why: "lib/i18n.ts is the client's catalogue runtime, and the server bundles lib/game/: take TranslationKey from shared/i18n.ts, and leave the words to the caller.",
    selector: importsOf("/^(?!.*shared\\x2Fi18n).*(^|\\x2F)i18n(\\.ts)?$/"),
    files: ["lib/game/**/*.{ts,tsx}"],
    plant: { file: "lib/game/rating.ts", code: [
      'import type { TranslationKey } from "../i18n";',
      'import { t } from "@/lib/i18n";',
      'import type { TFn } from "../i18n.ts";',
    ].join("\n"), hits: 3 },
    spare: [
      'import type { TranslationKey } from "../../shared/i18n.ts";',
      'import type { TranslationKey } from "@/shared/i18n";',
      '// import "../i18n"\nconst s = "../i18n";',
    ].map((code) => ({ file: "lib/game/rating.ts", code })),
  },
  {
    id: "server-reads-one-clock",
    why: "The server tells time through one clock a test can install: read it with now() from server/http/clock.ts, and write a timestamp as new Date(now()).",
    selector: [
      'MemberExpression[property.name="now"]:matches([object.name="Date"], [object.property.name="Date"])',
      'NewExpression[arguments.length=0]:matches([callee.name="Date"], [callee.property.name="Date"])',
      'CallExpression:matches([callee.name="Date"], [callee.property.name="Date"])',
      'VariableDeclarator[init.name="Date"] > ObjectPattern > Property[key.name="now"]',
    ].join(", "),
    files: ["server/**/*.ts"],
    ignores: [
      { glob: "server/http/clock.ts", reason: "the real clock is the one wall-time read the rest go through" },
      { glob: "server/store/drainPool.ts", reason: "waits on real pool I/O at shutdown; under an installed fake clock the wait would spin forever" },
      { glob: "server/socket/socketAdapter.ts", reason: "waits on a real Postgres LISTEN subscription; under an installed fake clock the wait would spin forever" },
    ],
    plant: { file: "server/game/stats.ts", code: [
      "const at = Date.now();",
      "const stamp = new Date();",
      "const read = Date.now;",
      "setTimeout(() => {}, Date.now() - since);",
      "const text = Date();",
      "const late = new Date;",
      "const viaGlobal = globalThis.Date.now();",
      "const newGlobal = new globalThis.Date();",
      "const calledGlobal = globalThis.Date();",
      "const { now: wall } = Date;",
    ].join("\n"), hits: 10 },
    spare: [
      "const at = now();",
      "const stamp = new Date(now());",
      "const when = new Date(row.createdAt);",
      "const t = Date.parse(raw);",
      "const u = Date.UTC(2026, 0, 1);",
      "const g = new globalThis.Date(now());",
      "const { parse } = Date;",
      '// Date.now() is the wall clock\nconst s = "new Date()";',
    ].map((code) => ({ file: "server/game/stats.ts", code })),
  },
  {
    id: "e2e-flag-owner",
    why: "lib/e2eConfig.ts is the one reader of the e2e build flag, so a player's build has one gate to prove: call e2eFast(), or read e2e.* or storedFlag() there.",
    selector:
      'MemberExpression[object.property.name="env"]:matches([property.name="EXPO_PUBLIC_E2E_FAST"], [property.value="EXPO_PUBLIC_E2E_FAST"])',
    files: CLIENT,
    ignores: [{ glob: "lib/e2eConfig.ts", reason: "the one reader the rest call" }],
    plant: { file: "components/Plant.tsx", code: [
      'const fast = process.env.EXPO_PUBLIC_E2E_FAST === "1";',
      'if (process.env["EXPO_PUBLIC_E2E_FAST"] !== "1") stop();',
      "const raw = globalThis.process.env.EXPO_PUBLIC_E2E_FAST;",
    ].join("\n"), hits: 3 },
    spare: [
      "const fast = e2eFast();",
      'const reduced = process.env.EXPO_PUBLIC_E2E_REDUCE_MOTION === "1";',
      '// process.env.EXPO_PUBLIC_E2E_FAST\nconst s = "EXPO_PUBLIC_E2E_FAST";',
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
];

// eslint's --cache keys a plugin's results on its meta.version, so an unversioned guard edit would
// leave cached results standing.
const version = require("node:crypto")
  .createHash("sha256")
  .update(JSON.stringify(GUARDS.map(({ id, why, selector, files, ignores }) => ({ id, why, selector, files, ignores }))))
  .digest("hex")
  .slice(0, 16);

const plugin = {
  meta: { name: "murlan", version },
  rules: Object.fromEntries(
    GUARDS.map((guard) => [
      guard.id,
      {
        meta: { type: "problem", schema: [] },
        create: (context) => ({ [guard.selector]: (node) => context.report({ node, message: guard.why }) }),
      },
    ])
  ),
};

function guardBlocks() {
  return [
    { plugins: { murlan: plugin } },
    ...GUARDS.map((guard) => ({
      files: guard.files,
      ...(guard.ignores ? { ignores: guard.ignores.map((i) => i.glob) } : {}),
      rules: { [`murlan/${guard.id}`]: "error" },
    })),
  ];
}

module.exports = { GUARDS, plugin, guardBlocks };
