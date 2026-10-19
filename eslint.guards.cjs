// The one registry of forbidden-shape rules. Where a new one goes, and the floor every guard stands
// on, is docs/agents/checks.md § Where a forbidden-shape rule goes.

const CLIENT = ["{app,components,context,lib,locales,modules,shared}/**/*.{ts,tsx}"];
const SCREENS = ["{app,components,context,lib}/**/*.{ts,tsx}"];
const DRAWN = ["{app,components}/**/*.tsx"];

function some(node, pred) {
  if (!node || typeof node.type !== "string") return false;
  if (pred(node)) return true;
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    const kids = Array.isArray(value) ? value : [value];
    if (kids.some((kid) => kid && typeof kid === "object" && some(kid, pred))) return true;
  }
  return false;
}

const nameOf = (node) =>
  node?.type === "Identifier" || node?.type === "JSXIdentifier"
    ? node.name
    : node?.type === "Literal" && typeof node.value === "string"
      ? node.value
      : null;
const propertyName = (member) => (member.computed && member.property.type !== "Literal" ? null : nameOf(member.property));
const isMember = (node, object, property) =>
  node?.type === "MemberExpression" && nameOf(node.object) === object && propertyName(node) === property;

function isClockCall(node) {
  if (node.type !== "CallExpression") return false;
  const c = node.callee;
  return (
    isMember(c, "Date", "now") ||
    isMember(c, "performance", "now") ||
    isMember(c, "process", "hrtime") ||
    (c.type === "MemberExpression" && propertyName(c) === "bigint" && isMember(c.object, "process", "hrtime"))
  );
}

function rootName(node) {
  while (node?.type === "MemberExpression") node = node.object;
  return nameOf(node);
}

const isAssertion = (call) =>
  call.type === "CallExpression" && ["assert", "expect"].includes(rootName(call.callee));

function insideAssertionArgs(context, node) {
  const chain = [...context.sourceCode.getAncestors(node), node];
  return chain.some((anc, i) => isAssertion(anc) && anc.arguments.includes(chain[i + 1]));
}

function isFixed(node) {
  if (node.type === "Literal" && typeof node.value === "number") return node.value !== 0 && node.value !== 1;
  if (node.type === "Literal" && node.bigint) return node.bigint !== "0" && node.bigint !== "1";
  return node.type === "Identifier" && /^[A-Z][A-Z\d_]*$/.test(node.name);
}

function startsWith(node, pattern) {
  if (node?.type === "Literal" && typeof node.value === "string") return pattern.test(node.value);
  if (node?.type === "TemplateLiteral") return pattern.test(node.quasis[0].value.cooked ?? "");
  return false;
}

const GUARDS = [
  {
    id: "no-focused-test",
    message:
      "A focused test makes jest skip the rest of its file and Playwright the rest of its shard, green either way: drop the `.only`.",
    files: ["tests/**/*.{ts,tsx,mjs}", "tools/loop/tests/**/*.{ts,mjs}"],
    plant: [
      'it.only("x", () => {});',
      'test.describe.only("y", () => {});',
      'fit("x", () => {});',
      'fdescribe("y", () => {});',
      'test("z", { only: true }, () => {});',
    ],
    spare: ['// it.only("x")\nconst profit = 1; benefit(2); onlyOnce(); split(".only(");', 'test("z", { only: false }, () => {});'],
    create: (report) => ({
      CallExpression(node) {
        const c = node.callee;
        const tests = ["it", "test", "describe", "suite"];
        const only =
          c.type === "MemberExpression" &&
          propertyName(c) === "only" &&
          (tests.includes(nameOf(c.object)) || (c.object.type === "MemberExpression" && propertyName(c.object) === "describe" && tests.includes(nameOf(c.object.object))));
        if (only || ["fit", "fdescribe"].includes(nameOf(c))) report(node);
      },
      Property(node) {
        if (nameOf(node.key) === "only" && node.value.type === "Literal" && node.value.value === true) report(node);
      },
    }),
  },
  {
    id: "no-wall-clock-budget",
    message:
      "This asserts on how fast the machine ran, so a loaded runner fails it on code that is fine. Assert what the timing stood in for (a marker, a work counter, a state count) and leave the clock to the test's own timeout. Comparing one measurement against another stays allowed.",
    files: ["tests/**/*.{ts,tsx}"],
    plant: [
      'const elapsedMs = Date.now() - start;\nassert.ok(elapsedMs < 2000, "slow");',
      "const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;\nassert.ok(elapsedMs < 50);",
      'const elapsed = Date.now() - startedAt;\nassert.ok(\n  elapsed < PROMPT_MS,\n  "hung"\n);',
      "const t0 = performance.now();\nexpect(performance.now() - t0).toBeLessThan(100);",
      'const start = Date.now();\nassert.ok(Date.now() - start < 2000, "slow");',
      "const start = Date.now();\nconst end = Date.now();\nassert.ok(end - start < 2000);",
      "let took = performance.now() - t0;\nexpect(took).toBeLessThanOrEqual(100);",
      "const took = Date.now() - t0;\nassert.ok(2000 > took);",
    ],
    spare: [
      "const limitedMs = performance.now() - t0;\nassert.ok(limitedMs > genuineAvg * 0.5);",
      'const elapsedMs = Date.now() - t0;\nassert.ok(elapsedMs > 0, "the clock was never read");',
      "const elapsedMs = Date.now() - t0;\nif (elapsedMs > 100) retry();",
      "const started = Date.now();\nassert.ok(frames > 30);",
      'const deadline = Date.now() + 5000;\nawait waitFor(socket, "x", 5000);',
    ],
    create: (report, context) => {
      const held = new Set();
      const candidates = [];
      const measured = (node) => some(node, (n) => isClockCall(n) || (n.type === "Identifier" && held.has(n.name)));
      return {
        VariableDeclarator(node) {
          if (node.id.type === "Identifier" && node.init && some(node.init, isClockCall)) held.add(node.id.name);
        },
        BinaryExpression(node) {
          if (["<", ">", "<=", ">="].includes(node.operator) && insideAssertionArgs(context, node)) candidates.push(node);
        },
        CallExpression(node) {
          if (node.callee.type === "MemberExpression" && /^toBe(?:Less|Greater)Than(?:OrEqual)?$/.test(propertyName(node.callee) ?? "")) {
            candidates.push(node);
          }
        },
        "Program:exit"() {
          for (const node of candidates) {
            if (node.type === "BinaryExpression") {
              const { left, right } = node;
              if ((measured(left) && isFixed(right)) || (measured(right) && isFixed(left))) report(node);
              continue;
            }
            let expected = node.callee.object;
            while (expected.type === "MemberExpression") expected = expected.object;
            const subject = expected.type === "CallExpression" && nameOf(expected.callee) === "expect" ? expected.arguments[0] : null;
            if (subject && node.arguments[0] && isFixed(node.arguments[0]) && measured(subject)) report(node);
          }
        },
      };
    },
  },
  {
    id: "intents-go-through-send",
    message:
      "A bare `emit` is at-most-once and carries no intentId, so its loss is silent and its retry is a second intent: send it through `send()` in lib/sendIntent.ts.",
    files: CLIENT,
    ignores: ["lib/sendIntent.ts"],
    plant: ['socket?.emit("room:leave");', "socket.emit(`game:play`, { cards });"],
    spare: ['socket.emit("connect_error");', 'send(socket, "room:leave", {});', 'emitter.on("room:leave", f);'],
    create: (report) => ({
      CallExpression(node) {
        if (node.callee.type === "MemberExpression" && propertyName(node.callee) === "emit" && startsWith(node.arguments[0], /^(?:room|game):/)) {
          report(node);
        }
      },
    }),
  },
  {
    id: "springs-are-tokens",
    message:
      "This declares a spring instead of naming one, so the design system cannot reach it: use Motion.spring.* from lib/tokens.ts, and if none fits, the design wants a new one.",
    files: SCREENS,
    ignores: ["lib/tokens.ts"],
    plant: ["const s = { damping: D, stiffness: 200 };", "withSpring(1, { dampingRatio: 0.4 });", 'const s = { "damping": 12 };'],
    spare: ["const s = { stiffness: 200 };", "type Spring = { damping: number };", "const { damping } = Motion.spring.land;"],
    create: (report) => ({
      Property(node) {
        if (node.parent.type === "ObjectExpression" && ["damping", "dampingRatio"].includes(nameOf(node.key))) report(node);
      },
    }),
  },
  {
    id: "home-field-is-fixed",
    message:
      "The home screen's drifting cards are a fixed composition (components/homeCardField.ts), so no part of it is drawn at random.",
    files: ["app/index.tsx", "components/homeCardField.ts"],
    plant: ["const x = Math.random() * 10;"],
    spare: ["const x = restingPose(card).rise;", "const random = 1; const y = rng.random();"],
    create: (report) => ({
      CallExpression(node) {
        if (isMember(node.callee, "Math", "random")) report(node);
      },
    }),
  },
  {
    id: "seat-identity-through-viewer-owns-seat",
    message:
      "A watcher's seat answers yes to this: ask `viewerOwnsSeat(seat, viewerSeat, spectating)` from components/seatLayout.ts instead of comparing by hand.",
    files: ["components/GameTable.tsx", "app/(online)/game.tsx", "app/(online)/replay.tsx"],
    plant: ["const mine = seat === viewerSeat;", "if (mySeatIndex === p.seat) go();", "const me = state.viewerSeat === seat;"],
    spare: ["const others = players.filter((p) => p.seat !== viewerSeat);", "const mine = viewerOwnsSeat(seat, viewerSeat, spectating);"],
    create: (report) => {
      const identity = (n) =>
        ["viewerSeat", "mySeatIndex"].includes(n.type === "MemberExpression" ? propertyName(n) : nameOf(n));
      return {
        BinaryExpression(node) {
          if (node.operator === "===" && (identity(node.left) || identity(node.right))) report(node);
        },
      };
    },
  },
  {
    id: "one-modal-element",
    message:
      "Render <AppModal> instead: a second <Modal> is a second place to get supportedOrientations, statusBarTranslucent and onRequestClose wrong.",
    files: DRAWN,
    ignores: ["components/AppModal.tsx"],
    plant: ["const x = <Modal visible />;"],
    spare: ["const x = <AppModal visible />;", "const x = <ModalFoo />;"],
    create: (report) => ({
      JSXOpeningElement(node) {
        if (nameOf(node.name) === "Modal") report(node);
      },
    }),
  },
  {
    id: "one-modal-import",
    message: "components/AppModal.tsx is the only reader of react-native's Modal, under any name: render <AppModal>.",
    files: SCREENS,
    ignores: ["components/AppModal.tsx"],
    plant: [
      'import { View, Modal as Sheet } from "react-native";',
      'import * as RN from "react-native";\nconst x = RN.Modal;',
      'export { Modal } from "react-native";',
      'import {\n  Text,\n  Modal,\n} from "react-native";',
      'import * as N from "react-native";\nconst { View, Modal: M } = N;',
      'import * as B from "react-native";\nconst Sheet = B["Modal"];',
    ],
    spare: [
      'import { type ModalProps, Pressable } from "react-native";',
      'import { Modal as Other } from "./Modal";',
      'import * as Unused from "react-native";',
    ],
    create: (report, context) => {
      const fromRN = (node) => node.source?.value === "react-native";
      const modalVia = (ref) => {
        const id = ref.identifier;
        const p = id.parent;
        if (p.type === "MemberExpression" && p.object === id && propertyName(p) === "Modal") return true;
        return (
          p.type === "VariableDeclarator" &&
          p.init === id &&
          p.id.type === "ObjectPattern" &&
          p.id.properties.some((prop) => prop.type === "Property" && nameOf(prop.key) === "Modal")
        );
      };
      return {
        ImportDeclaration(node) {
          if (!fromRN(node)) return;
          for (const spec of node.specifiers) {
            if (spec.type === "ImportSpecifier") {
              if (nameOf(spec.imported) === "Modal") report(spec);
              continue;
            }
            const [variable] = context.sourceCode.getDeclaredVariables(spec);
            for (const ref of variable?.references ?? []) if (modalVia(ref)) report(ref.identifier);
          }
        },
        ExportNamedDeclaration(node) {
          if (!fromRN(node)) return;
          for (const spec of node.specifiers) if (nameOf(spec.local) === "Modal") report(spec);
        },
      };
    },
  },
  {
    id: "modal-keeps-landscape",
    message:
      "React Native's <Modal> defaults to portrait on iOS, so opening one in landscape rotates the app and every tap lands on nothing: declare supportedOrientations including landscape.",
    files: DRAWN,
    plant: ["const x = <Modal visible />;", 'const x = <Modal supportedOrientations={["portrait"]} />;'],
    spare: ['const x = <Modal supportedOrientations={["portrait", "landscape"]} />;', "const x = <AppModal visible />;"],
    create: (report, context) => ({
      JSXOpeningElement(node) {
        if (nameOf(node.name) !== "Modal") return;
        const prop = node.attributes.find((a) => a.type === "JSXAttribute" && nameOf(a.name) === "supportedOrientations");
        if (!prop || !context.sourceCode.getText(prop).includes("landscape")) report(node);
      },
    }),
  },
  {
    id: "orientation-lock-owner",
    message: "Only the game table forces an orientation (components/GameTable.tsx): it is the one screen that needs the width.",
    files: SCREENS,
    ignores: ["components/GameTable.tsx"],
    plant: ["ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);", 'import { lockPlatformAsync } from "expo-screen-orientation";'],
    spare: ["ScreenOrientation.unlockAsync();", "const locked = true;"],
    create: (report) => ({
      Identifier(node) {
        if (/^lock\w*Async$/.test(node.name)) report(node);
      },
    }),
  },
  {
    id: "never-portrait-lock",
    message: "Nothing may lock the player into portrait: one held in landscape would be yanked round behind their back.",
    files: SCREENS,
    plant: ["lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);", "lockAsync(OrientationLock.PORTRAIT_UP);"],
    spare: ["lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);", "const PORTRAIT = 1;"],
    create: (report) => ({
      MemberExpression(node) {
        const owner = node.object.type === "MemberExpression" ? propertyName(node.object) : nameOf(node.object);
        if (owner === "OrientationLock" && /^PORTRAIT/.test(propertyName(node) ?? "")) report(node);
      },
    }),
  },
  {
    id: "screens-are-unconditional",
    message:
      "expo-router hands a falsy child to the navigator, which logs \"Layout children must be of type Screen\" on every render: guard the route with <Stack.Protected guard={…}>.",
    files: ["app/**/_layout.tsx"],
    plant: ['const x = <Stack>{__DEV__ && <Stack.Screen name="capture" />}</Stack>;', 'const x = <Tabs>{ready ? <Tabs.Screen name="x" /> : null}</Tabs>;'],
    spare: [
      'const x = <Stack><Stack.Screen name="index" /></Stack>;',
      'const x = <Stack><Stack.Protected guard={ok}><Stack.Screen name="capture" /></Stack.Protected></Stack>;',
    ],
    create: (report) => ({
      "JSXExpressionContainer > :matches(LogicalExpression, ConditionalExpression)"(node) {
        if (some(node, (n) => n.type === "JSXOpeningElement" && n.name.type === "JSXMemberExpression" && n.name.property.name === "Screen")) {
          report(node);
        }
      },
    }),
  },
  {
    id: "leave-through-leave-screen",
    message:
      "Leave through `leaveScreen` (components/ScreenHeader.tsx): a screen a link opened has no history, and a bare back does nothing there.",
    files: SCREENS,
    ignores: ["components/ScreenHeader.tsx"],
    plant: ["router.back();", 'router["back"]();', "const { back } = router;"],
    spare: ["leaveScreen(router);", "Easing.out(Easing.back(1.7));", "if (router.canGoBack()) leaveScreen(router);"],
    create: (report) => ({
      MemberExpression(node) {
        if (isMember(node, "router", "back")) report(node);
      },
      VariableDeclarator(node) {
        if (nameOf(node.init) === "router" && node.id.type === "ObjectPattern" && node.id.properties.some((p) => p.type === "Property" && nameOf(p.key) === "back")) {
          report(node);
        }
      },
    }),
  },
];

const plugin = {
  meta: { name: "guards" },
  rules: Object.fromEntries(
    GUARDS.map((guard) => [
      guard.id,
      {
        meta: { type: "problem", schema: [], messages: { guard: guard.message } },
        create: (context) => guard.create((node) => context.report({ node, messageId: "guard" }), context),
      },
    ])
  ),
};

function guardBlocks() {
  return [
    { plugins: { guards: plugin }, linterOptions: { reportUnusedDisableDirectives: "error" } },
    ...GUARDS.map((guard) => ({
      files: guard.files,
      ...(guard.ignores ? { ignores: guard.ignores } : {}),
      rules: { [`guards/${guard.id}`]: "error" },
    })),
  ];
}

module.exports = { GUARDS, plugin, guardBlocks };
