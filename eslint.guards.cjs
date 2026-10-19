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

/** @type {readonly Guard[]} */
const GUARDS = [
  {
    id: "no-focused-test",
    why: "A focused test makes jest skip the rest of its file and Playwright the rest of its shard, green either way: drop the `.only`.",
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
    ignores: [{ glob: "lib/sendIntent.ts", reason: "send() is the one emit the rest go through" }],
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
    selector: `BinaryExpression[operator="==="]:matches([left.name=${SEAT_IDENTITY}], [right.name=${SEAT_IDENTITY}], [left.property.name=${SEAT_IDENTITY}], [right.property.name=${SEAT_IDENTITY}])`,
    files: ["components/GameTable.tsx", "app/(online)/game.tsx", "app/(online)/replay.tsx"],
    plant: { file: "components/GameTable.tsx", code: ["const mine = seat === viewerSeat;", "if (mySeatIndex === p.seat) go();", "const me = state.viewerSeat === seat;"].join("\n"), hits: 3 },
    spare: ["const others = players.filter((p) => p.seat !== viewerSeat);", "const mine = viewerOwnsSeat(seat, viewerSeat, spectating);"].map((code) => ({ file: "components/GameTable.tsx", code })),
  },
  {
    id: "one-modal",
    why: "components/AppModal.tsx is the only reader of react-native's Modal, under any name: render <AppModal>, since a second <Modal> is a second place to get supportedOrientations, statusBarTranslucent and onRequestClose wrong.",
    selector: [
      'ImportDeclaration[source.value="react-native"] > ImportSpecifier[imported.name="Modal"]',
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
    ].join("\n"), hits: 7 },
    spare: [
      'import { type ModalProps, Pressable } from "react-native";',
      'import { Modal as Other } from "./Modal";',
      'import * as Unused from "react-native";',
      "const x = <AppModal visible />;",
      "const x = <RN.ModalFoo />;",
      '// <Modal> from "react-native"\nconst s = "Modal";',
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "modal-keeps-landscape",
    why: "React Native's <Modal> defaults to portrait on iOS, so opening one in landscape rotates the app and every tap lands on nothing: declare supportedOrientations including landscape.",
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
    why: "Nothing may lock the player into portrait: one held in landscape would be yanked round behind their back.",
    selector: 'MemberExpression[property.name=/^PORTRAIT/]:matches([object.name="OrientationLock"], [object.property.name="OrientationLock"])',
    files: SCREENS,
    plant: { file: "components/Plant.tsx", code: ["lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);", "lockAsync(OrientationLock.PORTRAIT_UP);"].join("\n"), hits: 2 },
    spare: ["lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);", "const PORTRAIT = 1;"].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "screens-unconditional",
    why: "expo-router hands a falsy child to the navigator, which logs \"Layout children must be of type Screen\" on every render: guard the route with <Stack.Protected guard={…}>.",
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
      'CallExpression[callee.property.name="clear"][arguments.length=0]',
    ].join(", "),
    files: SCREENS,
    ignores: [
      { glob: "context/SocketContext.tsx", reason: "the sign-out, which empties the query cache" },
      { glob: "lib/device/audioEngine.ts", reason: "clears a Set it owns" },
      { glob: "lib/errorReporting.ts", reason: "clears a Set it owns" },
      { glob: "lib/reactions.ts", reason: "clears a Map it owns" },
    ],
    plant: { file: "lib/Plant.ts", code: [
      "queryClient.clear();",
      "qc.clear ();",
      'queryClient.removeQueries({ queryKey: ["/api/friends"] });',
      "queryClient.resetQueries();",
    ].join("\n"), hits: 4 },
    spare: ['url.searchParams.clear("x");', "queryClient.invalidateQueries();", '// qc.clear()\nconst s = "qc.clear()";'].map((code) => ({ file: "lib/Plant.ts", code })),
  },
  {
    id: "no-cwd-root",
    why: "The cwd is wherever the run was started, so a root read from it points somewhere else under another runner: take the root from the file's own path, as tests/tooling/lintGuards.test.ts does.",
    selector: 'CallExpression[callee.object.name="process"][callee.property.name="cwd"]',
    files: ["tests/**/*.{ts,tsx,js,mjs,cjs}"],
    ignores: [
      { glob: "tests/tooling/entry.test.ts", reason: "isInvokedDirectly resolves a relative argv1 against the cwd, which is the case it pins" },
      { glob: "tests/helpers/filesRunReporter.mjs", reason: "a reporter names files relative to where the run was started" },
    ],
    plant: { file: "tests/server/plant.test.ts", code: ['const root = path.resolve(process.cwd(), "sourcemaps");', "const home = process.cwd();"].join("\n"), hits: 2 },
    spare: [{ file: "tests/server/plant.test.ts", code: '// process.cwd() is wherever the run started\nconst s = "process.cwd()";\nconst root = path.resolve(import.meta.dirname, "..", "..");' }],
  },
];

const plugin = {
  meta: { name: "murlan" },
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
