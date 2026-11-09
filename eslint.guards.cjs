// The one registry of forbidden-shape rules. Where a new one goes, and the floor every guard stands
// on, is docs/agents/traps.md § Where a forbidden-shape rule goes.

/**
 * @typedef {object} Guard
 * @property {string} id Rule id under the plugin: `murlan/${id}`.
 * @property {string} why Reported at the site: the owner module or doc, and what to do instead.
 * @property {string} selector esquery over the AST, several shapes joined with ", "; never raw text.
 * @property {(context: import("eslint").Rule.RuleContext, report: (node: object) => void) => Record<string, (node: any) => void>} [scoped] Visitors for what a selector cannot say: where a name resolves to, or where a value flows. Each reports a node the selector does not, so no site is reported twice.
 * @property {string[]} files Flat-config globs the guard applies to.
 * @property {{ glob: string, reason: string }[]} [ignores] The only exemption form.
 * @property {{ file: string, code: string, hits: number } | { file: string, code: string, hits: number }[]} plant Each fires exactly `hits` times, linted as its `file`.
 * @property {{ file: string, code: string }[]} spare Shapes the guard must not catch.
 */

const CLIENT = ["{app,components,context,lib,locales,modules,shared}/**/*.{ts,tsx}"];
const SCREENS = ["{app,components,context,lib}/**/*.{ts,tsx}"];
const DRAWN = ["{app,components}/**/*.tsx"];
const TEST_RUNNERS = "/^(it|test|describe|suite)$/";
const TABLE_TEXT_SIZE = ":matches(Identifier[name=/_FS$/i], MemberExpression[object.name=/^FontSize$/i], MemberExpression[object.property.name=/^FontSize$/i])";
const SHORT_EDGES = "/^(BASE|MAX)_SHORT_EDGE$/";
const SEAT_IDENTITY ="/^(viewerSeat|mySeatIndex)$/";
const AUDIO_LAYERED = ["{app,components,context,lib,modules}/**/*.{ts,tsx}"];
const CHANNEL_KEYS = `/^(${Object.keys(require("./lib/harnessChannels.ts").CHANNELS).join("|")})$/`;
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

// A jest.mock or doMock of a module, by its literal path or a template literal ending in it.
const JEST_MOCK = 'CallExpression[callee.object.name="jest"][callee.property.name=/^(mock|doMock|setMock|unstable_mockModule)$/]';
const mockOf = (path, tail) =>
  [`${JEST_MOCK} > Literal:first-child[value=${path}]`, `${JEST_MOCK} > TemplateLiteral:first-child:has(TemplateElement[value.raw=${tail}])`].join(", ");

// Every way a test reaches into a module to replace it: a module mock under any spelling of its path, a
// namespace or default import (only a spy needs the module object), the module object from require,
// requireActual, requireMock, `import x = require` or a dynamic import, and a spy on one handed straight
// to jest.spyOn. `modules` are `@/`- or relative paths and `packages` bare ones, each an alternation; a
// deep path into a package counts.
const seamsOf = ({ modules, packages }) => {
  const ext = "(\\.[cm]?[jt]sx?)?(\\x2Findex(\\.[cm]?[jt]sx?)?)?\\x2F?";
  const pkg = packages ? `|^(${packages})(\\x2F.*)?` : "";
  const path = `/(^(@|\\.\\.?(\\x2F\\.\\.)*)\\x2F(${modules})${ext}$${pkg})$/`;
  const tail = `/((^|\\x2F)(${modules})${ext}$${pkg})$/`;
  const required = `CallExpression:matches([callee.name="require"], [callee.object.name="jest"][callee.property.name=/^require(Actual|Mock)$/])[arguments.0.value=${path}]`;
  const spy = 'CallExpression[callee.object.name="jest"][callee.property.name="spyOn"]';
  return [
    mockOf(path, tail),
    `ImportDeclaration[source.value=${path}]:has(ImportNamespaceSpecifier, ImportDefaultSpecifier)`,
    `VariableDeclarator[id.type="Identifier"] > ${required}`,
    `VariableDeclarator[id.type="Identifier"] > TSAsExpression > ${required}`,
    `${spy} > ${required}:first-child`,
    `ImportExpression[source.value=${path}]:not(VariableDeclarator[id.type="ObjectPattern"] > AwaitExpression > ImportExpression)`,
    `TSImportEqualsDeclaration > TSExternalModuleReference > Literal[value=${path}]`,
  ].join(", ");
};

// An element passing `attr` by name: one handed in through a spread, or whose value can be undefined in either branch of a choice, is drawn the default.
const MAYBE_UNDEFINED = [
  '[value.expression.type="Identifier"][value.expression.name="undefined"]',
  '[value.expression.type="ConditionalExpression"]:matches([value.expression.consequent.type="Identifier"][value.expression.consequent.name="undefined"], [value.expression.alternate.type="Identifier"][value.expression.alternate.name="undefined"])',
  '[value.expression.type="LogicalExpression"]:matches([value.expression.operator="&&"], [value.expression.right.type="Identifier"][value.expression.right.name="undefined"])',
].join(", ");
const esquery = require("esquery");
const namesProp = (attr) => `:has(> JSXAttribute[name.name="${attr}"]:not(:matches(${MAYBE_UNDEFINED})))`;
const NAMES_RESIZE_MODE = esquery.parse(namesProp("resizeMode"));
const IMAGE_NAMES = /^(Image|ImageBackground)$/;
const WINDOW_NAMES = /^(useWindowDimensions|Dimensions)$/;
const RN_MODULE = /^react-native(-web)?$/;
const esRegex = (re) => `/${re.source}/`;
const RN_IMAGE = esRegex(IMAGE_NAMES);
const RN_WINDOW = esRegex(WINDOW_NAMES);
const RN_SOURCE = esRegex(RN_MODULE);
const LAYOUT = 'MemberExpression:matches([property.name="layout"], [property.value="layout"]):matches([object.property.name="nativeEvent"], [object.name="nativeEvent"])';
const SIZE_ONLY = 'ObjectPattern:not(:has(> Property:not([computed=false][key.name=/^(width|height)$/][value.type="Identifier"]))):not(:has(> RestElement))';
const DEEP_RN_WINDOW = "/^react-native(\\x2FLibraries\\x2FUtilities|-web\\x2Fdist\\x2F(cjs\\x2F)?exports)\\x2F(useWindowDimensions|Dimensions)(\\x2Findex)?(\\.js)?$/";
const EVENT_PATTERN = ':matches(Property:matches([key.name="nativeEvent"], [key.value="nativeEvent"]) > ObjectPattern, VariableDeclarator:matches([init.property.name="nativeEvent"], [init.name="nativeEvent"]) > ObjectPattern)';

const PASS_THROUGH = new Set(["ChainExpression", "TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression", "TSTypeAssertion"]);

const unwrap = (node) => (node && PASS_THROUGH.has(node.type) ? unwrap(node.expression) : node);
const memberName = (node) => (node.computed ? node.property.value : node.property.name);

const references = new WeakMap();
function referenceOf(context, node) {
  const scope = context.sourceCode.getScope(node);
  if (!references.has(scope)) references.set(scope, new Map(scope.references.map((r) => [r.identifier, r])));
  return references.get(scope).get(node);
}

const namedIn = (pattern, binding) => {
  for (const p of pattern.properties) {
    const value = p.type === "Property" && p.value.type === "AssignmentPattern" ? p.value.left : p.value;
    if (value === binding && !p.computed) return p.key.name ?? p.key.value;
  }
  return undefined;
};

/**
 * What an expression stands for when it comes from react-native (or react-native-web): `{ whole }` for the
 * module object, `{ named }` for one of its exports, followed through imports, requires, awaited imports,
 * aliases, member reads, destructurings and defaulted parameters.
 */
function fromReactNative(context, expr, depth = 0) {
  const node = unwrap(expr);
  if (!node || depth > 8) return null;
  const next = (n) => fromReactNative(context, n, depth + 1);
  switch (node.type) {
    case "AwaitExpression":
      return next(node.argument);
    case "ImportExpression":
      return RN_MODULE.test(node.source.value) ? { whole: true } : null;
    case "CallExpression":
      return node.callee.name === "require" && RN_MODULE.test(node.arguments[0]?.value) ? { whole: true } : null;
    case "MemberExpression": {
      const key = memberName(node);
      return typeof key === "string" && next(node.object)?.whole ? { named: key } : null;
    }
    case "Identifier":
    case "JSXIdentifier": {
      const def = referenceOf(context, node)?.resolved?.defs[0];
      if (!def) return null;
      if (def.type === "ImportBinding") {
        const declaration = def.parent;
        if (!RN_MODULE.test(declaration.source.value) || declaration.importKind === "type" || def.node.importKind === "type") return null;
        return def.node.type === "ImportSpecifier" ? { named: def.node.imported.name ?? def.node.imported.value } : { whole: true };
      }
      if (def.type === "Variable") {
        const { id, init } = def.node;
        if (id === def.name) return next(init);
        if (id.type === "ObjectPattern") {
          const key = namedIn(id, def.name);
          return key !== undefined && next(init)?.whole ? { named: key } : null;
        }
      }
      if (def.type === "Parameter") {
        for (const param of def.node.params) {
          if (param.type !== "AssignmentPattern") continue;
          if (param.left === def.name) return next(param.right);
          const key = param.left.type === "ObjectPattern" ? namedIn(param.left, def.name) : undefined;
          if (key !== undefined && next(param.right)?.whole) return { named: key };
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/** Visitors for every way to pick `names` out of the react-native module object: a member read, a destructuring, an assignment to a pattern, a defaulted parameter. */
function pickedFromModule(context, report, names, { renamedOnly = false } = {}) {
  const picks = (pattern, source) => {
    if (pattern?.type !== "ObjectPattern") return;
    for (const p of pattern.properties) {
      const key = p.type === "Property" && !p.computed ? (p.key.name ?? p.key.value) : undefined;
      if (typeof key !== "string" || !names.test(key)) continue;
      if (renamedOnly && p.value.type === "Identifier" && p.value.name === key) continue;
      if (fromReactNative(context, source)?.whole) report(p);
    }
  };
  return {
    VariableDeclarator: (node) => picks(node.id, node.init),
    AssignmentExpression: (node) => node.operator === "=" && picks(node.left, node.right),
    AssignmentPattern: (node) => picks(node.left, node.right),
    MemberExpression(node) {
      if (names.test(memberName(node) ?? "") && fromReactNative(context, node.object)?.whole) report(node);
    },
  };
}
/** A value read of `nativeEvent` (as a member or as a bare name) and where it goes: only a member read or a destructuring may take it. */
function nativeEventEscapes(node) {
  let at = node;
  while (at.parent && PASS_THROUGH.has(at.parent.type)) at = at.parent;
  const parent = at.parent;
  if (parent.type === "MemberExpression" && parent.object === at) return false;
  if (parent.type === "VariableDeclarator" && parent.init === at) return parent.id.type !== "ObjectPattern";
  if (parent.type === "AssignmentExpression" && parent.right === at) return parent.left.type !== "ObjectPattern";
  return true;
}

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
    id: "skia-image-fit",
    why: "A Skia <Image> with no `fit` is drawn `contain`, and an <ImageShader> `none`: an image whose aspect or pixel size differs from its box is letterboxed or cropped, and only on windows shaped unlike the one it was checked on. Pass the fit by name, never through a spread or as undefined; an image laid over a design rect is `fill`, as components/table/feltCanvas.tsx draws its cloth.",
    selector: `JSXOpeningElement[name.name=/^(Image|ImageShader)$/]:has(> JSXAttribute[name.name="image"]):not(${namesProp("fit")})`,
    files: DRAWN,
    plant: { file: "components/Plant.tsx", code: [
      "const a = <Image image={cloth} x={0} y={0} width={w} height={h} />;",
      "const b = <Image\n  image={rail}\n  width={w}\n  height={h}\n/>;",
      "const c = <ImageShader image={weave} rect={r} />;",
      "const d = <Image image={cloth} fit={undefined} width={w} height={h} />;",
      'const e = <Image image={cloth} {...{ fit: "fill" }} width={w} height={h} />;',
    ].join("\n"), hits: 5 },
    spare: [
      'const a = <Image image={cloth} fit="fill" width={w} height={h} />;',
      'const b = <Image source={art} resizeMode="stretch" />;',
      "const c = <Atlas image={sheet} sprites={s} transforms={t} />;",
      'const d = <ImageShader image={weave} fit="fill" rect={r} />;',
      "const e = <Image image={cloth} fit={fit} width={w} height={h} />;",
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "image-resize-mode",
    why: "A React Native <Image> or <ImageBackground> with no `resizeMode` is drawn `cover`: art whose aspect differs from its box is cropped, and only in boxes shaped unlike the one it was checked in. Pass it as the prop, by name, on an image under its own name (Image, Animated.Image), as components/CardView.tsx draws its card art.",
    selector: [
      `ImportDeclaration[source.value=${RN_SOURCE}] > ImportSpecifier[imported.name=${RN_IMAGE}]:not([local.name=${RN_IMAGE}])`,
      `ExportNamedDeclaration[source.value=${RN_SOURCE}]:not([exportKind="type"]) > ExportSpecifier[local.name=${RN_IMAGE}]:not([exportKind="type"])`,
      `ExportAllDeclaration[source.value=${RN_SOURCE}]:not([exportKind="type"])`,
    ].join(", "),
    scoped: (context, report) => ({
      ...pickedFromModule(context, report, IMAGE_NAMES, { renamedOnly: true }),
      Identifier(node) {
        const { parent } = node;
        if (!IMAGE_NAMES.test(node.name) || parent.type === "TSTypeQuery" || (parent.type === "MemberExpression" && parent.object === node)) return;
        if (referenceOf(context, node)?.isRead() && fromReactNative(context, node)?.named === node.name) report(node);
      },
      JSXOpeningElement(node) {
        const tag = node.name;
        const tagged = tag.type === "JSXMemberExpression" ? IMAGE_NAMES.test(tag.property.name) : IMAGE_NAMES.test(fromReactNative(context, tag)?.named ?? "");
        const carries = node.attributes.some((a) => a.type === "JSXSpreadAttribute" || a.name.name === "source");
        if (tagged && carries && !esquery.matches(node, NAMES_RESIZE_MODE, [])) report(node);
      },
    }),
    files: DRAWN,
    plant: { file: "components/Plant.tsx", code: [
      'import { Image, ImageBackground } from "react-native";',
      'import { Image as RNImage } from "react-native";',
      'import * as RN from "react-native";',
      "const a = <Image source={art} style={ART_FILL} />;",
      "const b = <ImageBackground\n  source={felt}\n  style={s}\n/>;",
      "const c = <MaskedView maskElement={<Image source={art} style={s} />} />;",
      "const d = <Animated.Image source={s} />;",
      'const e = <Image source={art} resizeMode={undefined} style={{ resizeMode: "cover" }} />;',
      'const { Image: Pic } = require("react-native");',
      "const F = Animated.createAnimatedComponent(Image);",
      'const G = require("react-native").Image;',
      "const Alias = Image;",
      "let Late;\nLate = Image;",
      "const Tabs = { photo: Image, plain: View };",
      "const h = <Image {...imageProps} style={s} />;",
      'const i = <Image source={art} resizeMode={tall ? "cover" : undefined} />;',
      'const j = <Image source={art} resizeMode={tall && "cover"} />;',
      'const k = <Image source={art} resizeMode={undefined ?? undefined} />;',
      'const M = RN.Image;\nconst N = RN["ImageBackground"];',
      "const { Image: Pic2 } = RN;",
      'const { ImageBackground: Back } = require("react-native");',
      "const Both = RN;\nconst P = Both.Image;",
      'export { Image as Pic3 } from "react-native";',
      'export { ImageBackground } from "react-native";',
      'export * from "react-native";',
      "const l = <Image source={art} image={x} />;",
      "const m = <RNImage source={art} />;",
      'const Late2 = await import("react-native");\nconst P4 = Late2.Image;',
      "({ Image: Pic5 } = RN);",
      "function pick({ Image: Pic6 } = RN) {}",
    ].join("\n"), hits: 29 },
    spare: [
      'import { Image } from "react-native";\nconst a = <Image source={art} style={ART_FILL} resizeMode="stretch" />;',
      'const b = <Image image={cloth} fit="fill" width={w} height={h} />;',
      'import { ImageBackground } from "react-native";\nconst c = <ImageBackground source={felt} resizeMode="cover" style={s} />;',
      'const d = <Animated.Image source={s} resizeMode="stretch" />;',
      'import { Image, View } from "react-native";',
      'import { Image as SkImage } from "@shopify/react-native-skia";',
      'import { Image } from "@shopify/react-native-skia";\nconst Alias = Image;\nconst a = <Image source={art} />;',
      'import { Image } from "react-native";\nconst size = Image.resolveAssetSource(art);\nImage.prefetch(url);',
      'import { Image } from "react-native";\nconst a = <Image source={art} resizeMode={fit} {...rest} />;',
      'import { Image } from "react-native";\nconst a = <Image source={art} resizeMode={tall ? "cover" : "contain"} />;',
      'import { Image } from "react-native";\nconst a = <Image source={art} resizeMode={fit ?? "cover"} />;',
      'import * as Other from "./other";\nconst a = Other.Image;\nconst { Image: Pic } = Other;',
      'import { Image } from "react-native";\ntype T = typeof Image;',
      'const a = <Image image={cloth} fit="fill" {...rest} />;',
      'import { Image } from "@shopify/react-native-skia";\nconst a = <Image image={cloth} fit="fill" {...rest} />;',
      'import * as RN from "react-native";\nconst { View, Text } = RN;\nconst { Image } = require("react-native");',
      'export type * from "react-native";',
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "svg-aspect",
    why: "An <Svg> with a `viewBox` and no `preserveAspectRatio` is drawn `xMidYMid meet`: a box whose aspect drifts from the viewBox's letterboxes the drawing inside it. Pass it by name, never through a spread or as undefined, as components/table/scorePill.tsx draws its icons.",
    selector: `JSXOpeningElement[name.name="Svg"]:has(> JSXAttribute[name.name="viewBox"]):not(${namesProp("preserveAspectRatio")})`,
    files: DRAWN,
    plant: { file: "components/Plant.tsx", code: [
      'const a = <Svg width={w} height={h} viewBox="0 0 7 5" />;',
      "const b = <Svg\n  viewBox={BOX}\n  width={s}\n  height={s}\n>{x}</Svg>;",
      'const c = <Svg viewBox="0 0 7 5" preserveAspectRatio={undefined} />;',
      'const d = <Svg viewBox="0 0 7 5" {...{ preserveAspectRatio: "none" }} />;',
    ].join("\n"), hits: 4 },
    spare: [
      'const a = <Svg width={w} height={h} viewBox="0 0 7 5" preserveAspectRatio="xMidYMid meet" />;',
      "const b = <Svg width={w} height={h} style={s} />;",
      'const c = <View viewBox="0 0 1 1" />;',
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "onlayout-size-only",
    why: "On web `onLayout` is a ResizeObserver, which fires on a change of size and never of position, so an x or y read from it goes stale the first time the box moves at the same size: read `nativeEvent.layout.width` or `.height` directly, or destructure `{ width, height }` from it, as components/NotificationBanner.tsx does; every other read or binding of it is refused.",
    selector: [
      `MemberExpression:not([computed=false][property.name=/^(width|height)$/]) > ${LAYOUT}.object`,
      `:not(MemberExpression, VariableDeclarator) > ${LAYOUT}`,
      `MemberExpression > ${LAYOUT}.property`,
      `VariableDeclarator:not(:has(> ${SIZE_ONLY}.id)) > ${LAYOUT}.init`,
      `${EVENT_PATTERN} > Property:matches([key.name="layout"], [key.value="layout"]):not(:has(> ${SIZE_ONLY}.value))`,
      `${EVENT_PATTERN} > RestElement`,
    ].join(", "),
    files: SCREENS,
    plant: { file: "components/Plant.tsx", code: [
      "const a = (e) => setTop(e.nativeEvent.layout.y);",
      "const { x, width } = e.nativeEvent.layout;",
      "const c = ({ nativeEvent: { layout: { y } } }) => setTop(y);",
      "const d = ({ nativeEvent }) => nativeEvent.layout.top;",
      "function f(e) { const { layout } = e.nativeEvent; return layout.y; }",
      "function g(e) { const { nativeEvent } = e; return nativeEvent.layout.y; }",
      "const { layout: { y } } = e.nativeEvent;",
      "function h(e) { const L = e.nativeEvent.layout; return L.y; }",
      "function k(e) { const { layout } = e.nativeEvent; return layout['y']; }",
      "keep(e.nativeEvent.layout);",
      "const m = e.nativeEvent.layout['height'];",
      "const { ...rest } = e.nativeEvent;",
      "const n = e?.nativeEvent?.layout;",
    ].join("\n"), hits: 13 },
    spare: [
      "const a = (e) => setH(e.nativeEvent.layout.height);",
      "const { width, height } = e.nativeEvent.layout;",
      "const c = (e) => setY(e.nativeEvent.contentOffset.y);",
      "const d = seat.layout.x;",
      "const e = ({ nativeEvent: { layout: { width } } }) => setW(width);",
      "function g(e) { const { nativeEvent } = e; return nativeEvent.contentOffset.y; }",
      "const { layout } = props; const x = layout.x;",
      "const w = e?.nativeEvent.layout.width;",
      "function t(e) { const { pageX } = e.nativeEvent; return seat.layout.x + pageX; }",
      "function G(e) { const ne = e.nativeEvent; return seat.layout.x; }",
      "function H(props) { const onPress = (e) => { const ne = e.nativeEvent; }; return props.layout.width; }",
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "native-event-in-place",
    why: "An event's `nativeEvent` bound to a name of its own hides every later read through it from onlayout-size-only, which can follow only the name `nativeEvent`: destructure what the handler needs from it where it is read, as components/GameTable.tsx does.",
    selector: 'ObjectPattern > Property:matches([key.name="nativeEvent"], [key.value="nativeEvent"]):not([value.type="Identifier"][value.name="nativeEvent"]):not([value.type="ObjectPattern"])',
    scoped: (context, report) => ({
      MemberExpression(node) {
        if (memberName(node) === "nativeEvent" && nativeEventEscapes(node)) report(node);
      },
      Identifier(node) {
        if (node.name !== "nativeEvent") return;
        const read = context.sourceCode.getScope(node).references.find((r) => r.identifier === node);
        if (read?.isRead() && nativeEventEscapes(node)) report(node);
      },
    }),
    files: SCREENS,
    plant: { file: "components/Plant.tsx", code: [
      "function p(e) { const ne = e.nativeEvent; return ne.layout.y; }",
      "function q(e) { const ne = e.nativeEvent; keep(ne.layout); }",
      "function u(e) { let ne; ne = e.nativeEvent; const { layout: { y } } = ne; }",
      "const v = ({ nativeEvent: ne }) => ne.layout.y;",
      "function w(e) { const ne = e?.nativeEvent; }",
      "function x(e) { const ne = e.nativeEvent as LayoutEvent; }",
      "function y(e) { const ne = e.nativeEvent!; }",
      "function z(e) { const ne = e.nativeEvent satisfies object; }",
      "function A(e) { let ne; ne = e.nativeEvent as LayoutEvent; }",
      "function B(e) { const { nativeEvent } = e; const ne = nativeEvent; }",
      "function C(e) { const { nativeEvent } = e; let ne; ne = nativeEvent; }",
      "function D(e) { read(e.nativeEvent); }",
      "function E(e) { return { ne: e.nativeEvent }; }",
      "function F({ nativeEvent }) { const ne = (nativeEvent as any); }",
      "function G({ nativeEvent }) { const ne = cond ? nativeEvent : null; }",
      "function H(e) { return e.nativeEvent; }",
      "function I({ nativeEvent }) { return place(nativeEvent); }",
      "const J = (e) => e.nativeEvent;",
      "function K({ nativeEvent }) { return { nativeEvent }; }",
      "function L(e) { return [e?.nativeEvent]; }",
      "function M(e) { return <Pin event={e.nativeEvent} />; }",
      'function N(e) { read(e["nativeEvent"]); }',
    ].join("\n"), hits: 22 },
    spare: [
      "function t(e) { const { pageX } = e.nativeEvent; return seat.layout.x + pageX; }",
      "const a = (e) => setH(e.nativeEvent.layout.height);",
      "const b = ({ nativeEvent }) => nativeEvent.layout.width;",
      "const c = ({ nativeEvent: { layout: { width } } }) => setW(width);",
      "const d = seat.nativeEventCount;",
      "const f = (e) => setW(e?.nativeEvent?.layout?.width);",
      "const g = (e) => (e.nativeEvent as any).key;",
      "function h(e) { const { pageX, pageY } = e.nativeEvent; return place(pageX, pageY); }",
      "function i({ nativeEvent }) { const { layout } = nativeEvent; return layout.width; }",
      "function j(e) { let w; ({ width: w } = e.nativeEvent.layout); return w; }",
      "function k(e) { return e.nativeEvent.layout.width; }",
      "function l(e) { return place(e); }",
      "function m({ nativeEvent: { layout } }) { return layout.width; }",
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "window-through-orientation",
    why: "useWindowDimensions reads a size iOS can hand over in the wrong orientation on a cold start, and a second read of it drifts from the first: read the window with useOrientedWindow() or useIsLandscape() from lib/device/orientation.tsx, which measures the app's own root view.",
    selector: [
      `ImportDeclaration[source.value=${RN_SOURCE}]:not([importKind="type"]) > ImportSpecifier[imported.name=${RN_WINDOW}]:not([importKind="type"])`,
      `ExportAllDeclaration[source.value=${RN_SOURCE}]:not([exportKind="type"])`,
      `ExportNamedDeclaration[source.value=${RN_SOURCE}]:not([exportKind="type"]) > ExportSpecifier[local.name=${RN_WINDOW}]:not([exportKind="type"])`,
      importsOf(DEEP_RN_WINDOW, { values: true }),
    ].join(", "),
    scoped: (context, report) => pickedFromModule(context, report, WINDOW_NAMES),
    files: SCREENS,
    ignores: [{ glob: "lib/device/orientation.tsx", reason: "the one reader of the window, falling back to it until the root view is measured" }],
    plant: { file: "components/Plant.tsx", code: [
      'import { View, useWindowDimensions } from "react-native";',
      'import { Dimensions as D } from "react-native";',
      'import * as RN from "react-native";',
      "const { width } = RN.useWindowDimensions();",
      'export { useWindowDimensions } from "react-native";',
      'const { Dimensions: Dims } = require("react-native");',
      'const s = require("react-native").Dimensions.get("window");',
      'import useWD from "react-native/Libraries/Utilities/useWindowDimensions";',
      'const Dm = require("react-native/Libraries/Utilities/Dimensions");',
      'export { default as useWD2 } from "react-native/Libraries/Utilities/useWindowDimensions";',
      'export * from "react-native/Libraries/Utilities/Dimensions";',
      'const lazy = import("react-native/Libraries/Utilities/Dimensions.js");',
      'import * as Web from "react-native-web";\nconst { useWindowDimensions: useWin } = Web;',
      'import * as Native from "react-native";\nconst { Dimensions: Dim } = Native;\nconst d = Native["Dimensions"];',
      'export * from "react-native";',
      'export * from "react-native-web";',
      'import { useWindowDimensions as webWindow } from "react-native-web";',
      'import Dimensions from "react-native-web/dist/exports/Dimensions";',
      'import RNW from "react-native-web";\nconst e = RNW.useWindowDimensions;',
      'const RNR = require("react-native");\nconst { Dimensions: D3 } = RNR;',
      'import * as Assigned from "react-native";\nlet D4;\n({ Dimensions: D4 } = Assigned);',
      'const Lazy = await import("react-native");\nconst d5 = Lazy.Dimensions;\nconst { useWindowDimensions: u5 } = await import("react-native");',
      'import * as Defaulted from "react-native";\nfunction f({ Dimensions: D6 } = Defaulted) {}',
      'const Same = require("react-native");\nconst Alias = Same;\nconst d7 = Alias.useWindowDimensions;',
    ].join("\n"), hits: 25 },
    spare: [
      'import { useOrientedWindow } from "@/lib/device/orientation";',
      "const { width, height } = useOrientedWindow();",
      'type Size = ScaledSize;\nconst s = "useWindowDimensions";',
      'import type { Dimensions } from "react-native";',
      'import { type Dimensions, View } from "react-native";',
      'export type { Dimensions } from "react-native";',
      'import { useWindowDimensions } from "./fakeWindow";',
      'import type Dims2 from "react-native/Libraries/Utilities/Dimensions";',
      'import { useWindowDimensions as u2 } from "react-native-web-hooks/Libraries/Utilities/useWindowDimensions";',
      "const d = layout.Dimensions;",
      'import RN from "react-native";\nconst w = RN.PixelRatio.get();',
      'import * as RN from "react-native";\nconst { PixelRatio } = RN;\nconst p = RN["PixelRatio"];',
      "let size;\nconst [first] = list;\nfor (const { width } of items) keep(width);",
      'import * as Mine from "./fakeWindow";\nconst { useWindowDimensions } = Mine;\nconst d = Mine.Dimensions;',
      'const Dimensions = { get: () => 1 };\nconst { useWindowDimensions } = Dimensions;',
      'export type * from "react-native";',
      'import { Dimensions } from "react-native-web-hooks";',
      'export * from "react-native-gesture-handler";',
      'import * as Mine from "./fakeWindow";\nfunction f({ Dimensions } = Mine) {}\n({ Dimensions } = Mine);',
      'const Lazy = await import("./fakeWindow");\nconst d = Lazy.Dimensions;',
    ].map((code) => ({ file: "components/Plant.tsx", code })),
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
    id: "one-table-scale",
    why: "The table's scale is components/tableLayout.ts's decision: read `tableLayout(…).scale`, ask `tableScale(window)`, or take the scale as a parameter, never `cardScale` of a short edge, or a short edge over the base one, worked out again here.",
    selector: [
      'ImportSpecifier[imported.name="cardScale"]',
      'ExportSpecifier[local.name="cardScale"]',
      'CallExpression[callee.name="cardScale"]',
      'MemberExpression[property.name="cardScale"]',
      'MemberExpression[property.value="cardScale"]',
      'VariableDeclarator > ObjectPattern > Property[key.name="cardScale"]',
      `Identifier[name=${SHORT_EDGES}]:not(ImportSpecifier[imported.name=${SHORT_EDGES}] > .local, ExportSpecifier[local.name=${SHORT_EDGES}] > .exported, Property[shorthand=true] > .value)`,
      `MemberExpression[property.value=${SHORT_EDGES}]`,
      ':matches(BinaryExpression[operator="/"], AssignmentExpression[operator="/="])[right.type="Literal"][right.value=390]',
      'VariableDeclarator[init.type="Literal"][init.value=390]',
    ].join(", "),
    files: [...CLIENT, "tests/**/*.{ts,tsx}"],
    ignores: [
      { glob: "components/cardFaceModel.ts", reason: "cardScale and the base short edge it divides by are declared here" },
      { glob: "components/tableLayout.ts", reason: "tableScale is the one place the table's scale is taken from a window" },
      { glob: "components/table/noticeModel.ts", reason: "the mockup's own stage height, a design constant the notices are authored at, not a window" },
      { glob: "tests/ui-rules/cardFace.test.ts", reason: "pins cardScale itself, short edge in and scale out" },
      { glob: "tests/ui-rules/tableLayoutPin.test.ts", reason: "the deliberate independent copy of tableScale, which a regression in the owner cannot move" },
      { glob: "tests/ui-rules/noticeModel.test.ts", reason: "restates the mockup's unit as literals, never read back from the module, so a drifted mockupPx cannot move them" },
      { glob: "tests/e2e/helpers/cutout.ts", reason: "an iPhone notch's 209 pt over its own 390-pt edge, a device's measurement rather than the table's base" },
    ],
    plant: [
      { file: "components/Plant.tsx", code: [
        'import { cardScale as s } from "@/components/cardFaceModel";',
        "const a = cardScale(Math.min(width, height));",
        "const b = face.cardScale(h);",
        'const c = face["cardScale"];',
        'export { cardScale } from "./cardFaceModel";',
        "const { cardScale: d } = face;",
        "const e = Math.min(width, height, 900) / BASE_SHORT_EDGE;",
        'import { BASE_SHORT_EDGE as BASE } from "@/components/cardFaceModel";',
        'import { BASE_SHORT_EDGE } from "../cardFaceModel";',
        'export { BASE_SHORT_EDGE } from "./cardFaceModel";',
        "const f = face.BASE_SHORT_EDGE;",
        'const g = face["MAX_SHORT_EDGE"];',
        "const { BASE_SHORT_EDGE: k } = face;",
        "const { MAX_SHORT_EDGE } = face;",
        "const m = Math.min(width, height) / 390;",
        "const n = edge / 390.0;",
        "const o = 320 / 390;",
        "const BASE = 390;",
        "let p = Math.min(w, h);\np /= 390;",
      ].join("\n"), hits: 19 },
      { file: "tests/ui-rules/plant.test.ts", code: [
        'import { cardScale } from "../../components/cardFaceModel.ts";',
        "const a = cardScale(Math.min(844, 390));",
        "const b = Math.min(w, h) / BASE_SHORT_EDGE;",
      ].join("\n"), hits: 3 },
      { file: "tests/e2e/plant.spec.ts", code: [
        "const scale = Math.min(vp.width, vp.height) / 390;",
        "const BASE_EDGE = 390;",
        "let edge = vp.width;\nedge /= 390;",
      ].join("\n"), hits: 3 },
      { file: "tests/native/plant.test.tsx", code: "const { cardScale: at } = require('@/components/cardFaceModel');", hits: 1 },
      ...["bots", "differential", "engine", "helpers", "integration", "model", "server", "soak", "support", "tooling"].map((dir) => ({
        file: `tests/${dir}/plant.test.ts`,
        code: "const scale = Math.min(w, h) / 390;",
        hits: 1,
      })),
      ...["app", "context", "lib", "locales", "modules", "shared"].map((dir) => ({
        file: `${dir}/plant.ts`,
        code: "const scale = Math.min(w, h) / BASE_SHORT_EDGE;",
        hits: 1,
      })),
    ],
    spare: [
      ...[
        "const cardScale = scale * FIELD_SCALE;",
        "const e = <PlayCard cardScale={cardScale} />;",
        "const f = catchLift(c, cardScale);",
        "const g = { cardScale: r.size.scale };",
        "const h = tableScale({ width, height });",
        '// cardScale(Math.min(w, h))\nconst i = "cardScale";',
        "const j = height - drawnShortEdge(scale);",
        '// Math.min(w, h) / BASE_SHORT_EDGE\nconst k = "BASE_SHORT_EDGE";',
      ].map((code) => ({ file: "components/Plant.tsx", code })),
      ...[
        "const VIEWPORT = { width: 844, height: 390 };",
        "const tall = 390 * scale;",
        "const half = width / 2;",
        "let w = width;\nw /= 2;\nw *= 390;",
      ].map((code) => ({ file: "tests/e2e/plant.spec.ts", code })),
    ],
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
    why: "Only the game table forces an orientation, through useLandscapeLock (lib/device/orientation.tsx): it is the one screen that needs the width.",
    selector: "Identifier[name=/^lock\\w*Async$/]",
    files: SCREENS,
    ignores: [{ glob: "lib/device/orientation.tsx", reason: "useLandscapeLock, which only the game table calls: the one screen that needs the width" }],
    plant: { file: "components/Plant.tsx", code: ["ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);", 'import { lockPlatformAsync as lockPlatform } from "expo-screen-orientation";'].join("\n"), hits: 2 },
    spare: ["ScreenOrientation.unlockAsync();", "const locked = true;", '// lockAsync\nconst s = "lockAsync";'].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "no-portrait-lock",
    why: "Nothing may lock the player into portrait: one held in landscape would be yanked round behind their back, and useLandscapeLock (lib/device/orientation.tsx) locks landscape alone.",
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
    id: "table-text-floor",
    why: "A table text size scaled by hand drops under 10px on an SE: size it with tableFontSize(base, scale) from components/cardFaceModel.ts, which holds the floor.",
    // The size is reported, not the product, so it is found at any depth of the left operand:
    // `1.2 * LABEL_FS * scale` parses as `(1.2 * LABEL_FS) * scale`.
    selector: ["> .left", "> .left "]
      .map((left) => `BinaryExpression[operator="*"]:matches([right.name=/scale$/i], [right.property.name=/scale$/i]) ${left}${TABLE_TEXT_SIZE}`)
      .join(", "),
    files: ["components/table/**/*.{ts,tsx}"],
    plant: { file: "components/table/Plant.tsx", code: [
      "const a = { fontSize: SEAT_BADGE_FS * scale };",
      "const b = { fontSize: FontSize.xxs * scale };",
      "const c = { fontSize: NAME_FS * cardScale };",
      "const d = { fontSize: T.LABEL_FS * layout.scale };",
      "const e = { fontSize: 1.2 * LABEL_FS * scale };",
      "const f = { fontSize: T.FontSize.xxs * scale };",
      "const g = { fontSize: fontsize.sm*Scale };",
      "const h = { fontSize: 2 * 0.5 * BADGE_FS * scale };",
    ].join("\n"), hits: 8 },
    spare: [
      "const a = { fontSize: tableFontSize(SEAT_BADGE_FS, scale) };",
      "const b = { width: CARD_W * scale };",
      '// SEAT_BADGE_FS * scale\nconst s = "FontSize.xxs * scale";',
    ].map((code) => ({ file: "components/table/Plant.tsx", code })),
  },
  {
    id: "web-drops-a11y-prop",
    why: "react-native-web drops this prop, so the web build reaches it as nothing: use a11yState / a11yHint / a11yHidden from lib/a11y.tsx.",
    selector: "JSXAttribute[name.name=/^(accessibilityState|accessibilityHint|accessibilityElementsHidden|importantForAccessibility)$/]",
    files: DRAWN,
    plant: { file: "components/Plant.tsx", code: [
      'const a = <View accessibilityState={{ selected: true }} accessibilityLabel="x" />;',
      'const b = <Pressable accessibilityHint="opens" />;',
      "const c = <View accessibilityElementsHidden />;",
      "const d = <View importantForAccessibility=\"no\" />;",
    ].join("\n"), hits: 4 },
    spare: [
      "const a = <View {...a11yState({ selected: true })} accessibilityLabel={x} />;",
      '// accessibilityState={{ selected: true }}\nconst s = "accessibilityHint=";',
      "const o = { accessibilityState: s };",
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "animate-compositor-props",
    why: "On web reanimated writes this every frame from the JS thread and the browser repaints for it: put the glow on a childless pointerEvents=\"none\" sibling with a static Shadow token and animate its opacity (components/table/hand.tsx's cardGlow).",
    selector:
      'CallExpression:matches([callee.name="useAnimatedStyle"], [callee.property.name="useAnimatedStyle"]) Property:matches([key.name=/^(boxShadow|shadowRadius|shadowOpacity|shadowColor|elevation|border[A-Za-z]*Color)$/], [key.value=/^(boxShadow|shadowRadius|shadowOpacity|shadowColor|elevation|border[A-Za-z]*Color)$/])',
    files: ["{app,components}/**/*.{ts,tsx}"],
    plant: { file: "components/Plant.tsx", code: [
      "const s = useAnimatedStyle(() => {",
      "  const v = glow.value;",
      '  if (Platform.OS === "web") {',
      "    return { boxShadow: `0 0 ${v}px gold` } as any;",
      "  }",
      "  return { shadowRadius: 18 * v };",
      "});",
      "const t = useAnimatedStyle(() => ({ borderTopColor: c.value }));",
      'const w = useAnimatedStyle(() => ({ "elevation": 2 }));',
      "const u = Reanimated.useAnimatedStyle(() => ({ shadowRadius: r.value }));",
    ].join("\n"), hits: 5 },
    spare: [
      "const a = useAnimatedStyle(() => ({ opacity: v.value }));\nconst b = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));",
      "const glow = { shadowRadius: 18, boxShadow: Shadow.glow };",
      "const a = useAnimatedStyle(() => ({ opacity: v.value })); // not boxShadow\nconst s = \"shadowRadius\";",
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "read-a-slice",
    why: "A wide game hook wakes its reader on every field of the context: call the slice for this concern from context/gameHooks.ts or context/onlineGameHooks.ts.",
    selector: "CallExpression:matches([callee.name=/^use(Online)?Game(Session|Table)?$/], [callee.property.name=/^use(Online)?Game(Session|Table)?$/])",
    files: SCREENS,
    ignores: [{ glob: "context/gameHooks.ts", reason: "the local slices are built on the wide hooks" }],
    plant: { file: "components/Plant.tsx", code: ["const t = useGameTable();", "const { gameState } = useGameSession();", "const g = useOnlineGame();", "useGame();", "const c = ctx.useGameTable();"].join("\n"), hits: 5 },
    spare: [
      "const s = useGameSlice();\nconst h = ctx.useHandSlice();",
      '// useGameTable()\nconst s = "useOnlineGame()";',
      "export function useGameTable() { return ctx; }",
    ].map((code) => ({ file: "components/Plant.tsx", code })),
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
    id: "submit-through-hook",
    why: "A return key that submits needs both halves of the in-flight guard, and react-native-web fires it on a held Enter even while readOnly: spread `field` from useGuardedSubmit, or useReturnFocuses() for a field that only moves focus (lib/useGuardedSubmit.ts).",
    selector: 'JSXAttribute[name.name="onSubmitEditing"], Property:matches([key.name="onSubmitEditing"], [key.value="onSubmitEditing"])',
    files: SCREENS,
    ignores: [{ glob: "lib/useGuardedSubmit.ts", reason: "the hook that owns both halves of the guard" }],
    plant: { file: "app/Plant.tsx", code: [
      "const a = <TextInput onSubmitEditing={save} editable={!saving} />;",
      "const b = <TextInput {...{ onSubmitEditing: () => ref.current?.focus() }} />;",
      'const c = { "onSubmitEditing": submit };',
    ].join("\n"), hits: 3 },
    spare: [
      "const a = <TextInput {...submitField} />;",
      "const b = <TextInput {...emailReturn} />;",
      '// onSubmitEditing={save}\nconst s = "onSubmitEditing";',
    ].map((code) => ({ file: "app/Plant.tsx", code })),
  },
  {
    id: "codes-through-payload",
    why: "A code beside a hand-written sentence reaches a player with no locale entry checked and an English text that drifts from locales/en.ts: build it with payload() or refuse() from server/shared/payload.ts, whose ServerCode type is the catalogue.",
    selector:
      'ObjectExpression:has(> Property:matches([key.name=/^(message|error)$/], [key.value=/^(message|error)$/])) > Property:matches([key.name="code"], [key.value="code"])',
    files: ["server/**/*.ts", "shared/persistedEnvelope.ts", "shared/socketSchemas.ts", "shared/httpSchemas.ts"],
    ignores: [{ glob: "server/shared/payload.ts", reason: "payload() is the one builder the rest call" }],
    plant: { file: "server/game/stats.ts", code: [
      'socket.emit("game:error", { code: "ROOM_NOT_FOUND", message: "Room not found" });',
      "res.json({ message: err.message, code });",
      'const p = { "code": c, "error": `bad ${x}` };',
    ].join("\n"), hits: 3 },
    spare: [
      'return { ok: false, code: "ROOM_NOT_FOUND" };',
      'socket.emit("game:error", payload("ROOM_NOT_FOUND"));',
      'logger.error({ err, event }, "message");',
      '// { code: "X", message: "y" }\nconst s = "code, message";',
    ].map((code) => ({ file: "server/game/stats.ts", code })),
  },
  {
    id: "known-channel",
    why: "The browser suite reads a `data-*` channel by the name lib/harnessChannels.ts registers, so a key written anywhere else is one it will never find: register it in CHANNELS and read it through tests/e2e/helpers/selectors.ts.",
    selector: [
      'JSXAttribute[name.name="dataSet"] > JSXExpressionContainer > ObjectExpression',
      'Property:matches([key.name="dataSet"], [key.value="dataSet"]) > ObjectExpression',
      'CallExpression[callee.name="harnessState"] > ObjectExpression',
    ]
      .flatMap((writer) => [`${writer} > Property:not([key.name=${CHANNEL_KEYS}]):not([key.value=${CHANNEL_KEYS}])`, `${writer} > SpreadElement`])
      .concat([
        'JSXAttribute[name.name="dataSet"] > JSXExpressionContainer[expression.type!="ObjectExpression"]',
        'Property:matches([key.name="dataSet"], [key.value="dataSet"])[value.type!="ObjectExpression"]',
      ])
      .join(", "),
    files: SCREENS,
    ignores: [{ glob: "components/table/chrome.tsx", reason: "harnessState passes on an object its parameter type already holds to the registered keys" }],
    plant: { file: "components/Plant.tsx", code: [
      "const a = <View dataSet={{ tableState: s, rogue: x }} />;",
      "const b = <View {...harnessState({ handStat: s })} />;",
      'const c = <Text {...({ dataSet: { "seat-lit": v } } as TextProps)} />;',
      "const d = <View dataSet={{ ...extra }} />;",
      "const e = <View dataSet={ds} />;",
      "const f = <Text {...({ dataSet: pick(x) } as TextProps)} />;",
    ].join("\n"), hits: 6 },
    spare: [
      "const a = <View dataSet={{ tableState: s, dealing: d }} />;",
      "const b = <View {...harnessState({ handState: s })} />;",
      'const c = <Text {...({ dataSet: { "seatLit": v } } as TextProps)} />;',
      "const d = { rogue: 1 };",
      "// dataSet={{ rogue: x }}\nconst s = \"dataSet\";",
    ].map((code) => ({ file: "components/Plant.tsx", code })),
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
    ignores: [
      { glob: "lib/device/audioEngine.ts", reason: "the owner of the audio engine" },
      { glob: "lib/diagnostics/probe.ts", reason: "the bench reads the session's latency and never configures it, which tests/tooling/probeReadsSessionOnly.test.ts holds" },
    ],
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
    id: "socket-owner",
    why: "lib/socket.ts holds the raw socket.io socket and hands out a `Socket` that cannot open, close or reach its engine, because closing one still connecting makes the browser log an error: reconnect through reopenSocket, reconnectSocket, closeSocket or haltSocket.",
    selector: importsOf("/^(socket|engine)\\.io-client(\\x2F|$)/"),
    files: CLIENT,
    ignores: [{ glob: "lib/socket.ts", reason: "the owner of the raw socket" }],
    plant: { file: "context/Plant.tsx", code: [
      'import { io } from "socket.io-client";',
      'import type { Socket } from "socket.io-client";',
      'export { io } from "socket.io-client";',
      'const s = import("socket.io-client");',
      'const m = require("socket.io-client");',
      'import { Manager } from "socket.io-client/build/esm/manager";',
      'import { Socket } from "engine.io-client";',
    ].join("\n"), hits: 7 },
    spare: [
      'import { Socket } from "@/lib/socket";',
      'import { x } from "socket.io-client-shim";',
      'import { y } from "engine.io-clients";',
      '// import "socket.io-client"\nconst s = "socket.io-client";',
    ].map((code) => ({ file: "context/Plant.tsx", code })),
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
    why: "A completion callback that ignores `finished` runs its follow-up on an animation that was cancelled: take `(finished)` and act only when it is true, as the sweep in components/table/pile.tsx does.",
    selector:
      'CallExpression[callee.name=/^(withTiming|withSpring|withDecay|withRepeat)$/] > :matches(ArrowFunctionExpression, FunctionExpression):matches([params.length=0], [params.0.name=/^_/])',
    files: SCREENS,
    plant: { file: "components/Plant.tsx", code: [
      "a.value = withTiming(1, { duration: 1 }, () => go());",
      "a.value = withSpring(1, {}, function () { go(); });",
      "a.value = withDecay({ velocity: 1 }, (_finished) => go());",
      "a.value = withRepeat(b, 2, false, () => go());",
    ].join("\n"), hits: 4 },
    spare: [
      "a.value = withTiming(1, { duration: 1 }, (finished) => { if (finished) go(); });",
      "a.value = withRepeat(b, 2, false, (finished) => { if (finished) go(); });",
      "setTimeout(() => go(), 10);",
      "const leg = (to) => withTiming(to, { duration: 1 });",
    ].map((code) => ({ file: "components/Plant.tsx", code })),
  },
  {
    id: "repeat-through-motion",
    why: "A repeat is lib/motion.ts's: run an endless one with `useLoop`, which never starts under reduced motion and is cancelled when it stops or its owner unmounts, and a counted one with `repeatTimes`, which never reads a count of 0 as forever.",
    selector: [
      'CallExpression[callee.name="withRepeat"]',
      'MemberExpression[property.name="withRepeat"]',
      'MemberExpression[computed=true][property.value="withRepeat"]',
      'ImportSpecifier[imported.name="withRepeat"]',
      'ExportSpecifier[local.name="withRepeat"]',
    ].join(", "),
    files: SCREENS,
    ignores: [{ glob: "lib/motion.ts", reason: "useLoop and repeatTimes, the two owners of a repeat" }],
    plant: { file: "components/Plant.tsx", code: [
      'import { withRepeat } from "react-native-reanimated";',
      'import { withRepeat as again } from "react-native-reanimated";',
      "a.value = withRepeat(b, -1);",
      "a.value = Reanimated.withRepeat(b, 2);",
      'export { withRepeat } from "react-native-reanimated";',
      'a.value = R["withRepeat"](b, 2);',
    ].join("\n"), hits: 6 },
    spare: [
      "useLoop(a, () => ({ cycle: b }));",
      'a.value = R["withRepeatCount"];',
      "a.value = repeatTimes(b, beats);",
      '// withRepeat(b, -1)\nconst s = "withRepeat(b, -1)";',
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
      { glob: "server/store/redis.ts", reason: "times real replies on real Redis sockets; under an installed fake clock the half-open watch would trip on a live link or never on a dead one" },
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
  {
    id: "motion-and-connectivity-are-knobs",
    why: "Motion and connectivity are knobs in tests/native/harness/env.ts, reset before every test: call setMotion or setConnectivity there; a module mock can answer what the real hook never would.",
    selector: [
      mockOf("/^(@|\\.\\.?(\\x2F\\.\\.)*)\\x2Flib\\x2Faccessibility(\\.ts)?$/", "/(^|\\x2F)lib\\x2Faccessibility(\\.ts)?$/"),
      mockOf("/^@react-native-community\\x2Fnetinfo$/", "/^@react-native-community\\x2Fnetinfo$/"),
      'CallExpression[callee.object.name="jest"][callee.property.name="spyOn"][arguments.1.value="usePrefersReducedMotion"]',
    ].join(", "),
    files: ["tests/native/**/*.{ts,tsx}"],
    ignores: [{ glob: "tests/native/setup.ts", reason: "installs the one netinfo mock whose listeners setConnectivity drives" }],
    plant: { file: "tests/native/plant.test.tsx", code: [
      "jest.mock('@/lib/accessibility', () => ({ usePrefersReducedMotion: () => true }));",
      'jest.mock("@react-native-community/netinfo", () => ({}));',
      "jest.doMock('@/lib/accessibility', () => ({}));",
      "jest.mock('../../lib/accessibility', () => ({}));",
      "jest.mock('../lib/accessibility.ts', () => ({}));",
      "jest.mock(`@/lib/accessibility`, () => ({}));",
      "jest.mock(`${root}/lib/accessibility`, () => ({}));",
      "jest.mock(`@react-native-community/netinfo`, () => ({}));",
      "jest.spyOn(accessibility, 'usePrefersReducedMotion');",
    ].join("\n"), hits: 9 },
    spare: [
      "await setMotion('on');",
      "jest.mock('@/lib/accessibilityLabels', () => ({}));",
      "jest.mock(`@/lib/accessibilityLabels`, () => ({}));",
      "jest.mock('../../lib/accessibility/extra', () => ({}));",
      "jest.requireActual('@/lib/accessibility');",
      "jest.spyOn(accessibility, 'getMotionPreference');",
    ].map((code) => ({ file: "tests/native/plant.test.tsx", code })),
  },
  {
    id: "window-is-a-knob",
    why: "The window is a knob in tests/native/harness/env.ts, reset before every test: call setWindow there, which moves Dimensions and every reader of it together.",
    selector: [
      mockOf("/^react-native\\x2FLibraries\\x2FUtilities\\x2FuseWindowDimensions(\\.js)?$/", "/(^|\\x2F)Libraries\\x2FUtilities\\x2FuseWindowDimensions(\\.js)?$/"),
      `${JEST_MOCK}[arguments.0.value="react-native"] Property[key.name="useWindowDimensions"]`,
      'CallExpression[callee.object.name="jest"][callee.property.name="spyOn"][arguments.1.value="useWindowDimensions"]',
    ].join(", "),
    files: ["tests/native/**/*.{ts,tsx}"],
    ignores: [
      { glob: "tests/native/orientationFirstRender.test.tsx", reason: "a cold bridge whose first window is wrong and never fires a change, which Dimensions.set cannot hold" },
      { glob: "tests/native/tableRelocksAfterEntry.test.tsx", reason: "a bridge frozen in portrait while Dimensions moves, which Dimensions.set cannot split" },
    ],
    plant: { file: "tests/native/plant.test.tsx", code: [
      "jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ default: () => W }));",
      'jest.doMock("react-native/Libraries/Utilities/useWindowDimensions", () => ({}));',
      "jest.mock(`react-native/Libraries/Utilities/useWindowDimensions`, () => ({}));",
      "jest.mock('react-native', () => ({ ...jest.requireActual('react-native'), useWindowDimensions: () => W }));",
      "jest.spyOn(ReactNative, 'useWindowDimensions');",
    ].join("\n"), hits: 5 },
    spare: [
      "await setWindow({ width: 390, height: 844 });",
      "jest.mock('react-native/Libraries/Utilities/Dimensions', () => ({}));",
      "jest.mock('react-native', () => ({ ...jest.requireActual('react-native'), Platform: { OS: 'ios' } }));",
      "const { width } = useWindowDimensions();",
    ].map((code) => ({ file: "tests/native/plant.test.tsx", code })),
  },
  {
    id: "socket-is-faked-at-the-wire",
    why: "The socket is faked where it meets socket.io (tests/native/mocks/socketIo.ts, installed by setup.ts): drive it with lastSocket() or renderApp's socket(), so lib/socket.ts and its ticket fetch run for real.",
    selector: mockOf("/^(@|\\.\\.?(\\x2F\\.\\.)*)\\x2Flib\\x2Fsocket(\\.ts)?$/", "/(^|\\x2F)lib\\x2Fsocket(\\.ts)?$/"),
    files: ["tests/native/**/*.{ts,tsx}"],
    plant: { file: "tests/native/plant.test.tsx", code: [
      "jest.mock('@/lib/socket', () => ({ connectSocket: () => s }));",
      'jest.doMock("../../lib/socket", () => ({}));',
      "jest.mock(`@/lib/socket`, () => ({}));",
    ].join("\n"), hits: 3 },
    spare: [
      "lastSocket().serverEmit('friend:invite', invite);",
      "jest.mock('socket.io-client', () => ({ io }));",
      "jest.mock('@/lib/sendIntent', () => ({}));",
    ].map((code) => ({ file: "tests/native/plant.test.tsx", code })),
  },
  {
    id: "account-renders-through-the-app",
    why: "Sign-in, banners and the query cache are the app's own (tests/native/harness/renderApp.tsx): pass renderApp a user, answer its fetches with route(), read banners with bannerLog().",
    selector: seamsOf({ modules: "context\\x2F(AuthContext|NotificationContext)|lib\\x2Fquery-client" }),
    files: ["tests/native/**/*.{ts,tsx}"],
    plant: { file: "tests/native/plant.test.tsx", code: [
      "jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user }) }));",
      'jest.doMock("../../context/NotificationContext", () => ({}));',
      "jest.mock(`@/lib/query-client`, () => ({}));",
      "jest.setMock('@/context/AuthContext', {});",
      "jest.mock('@/context/AuthContext.js', () => ({}));",
      "jest.mock('@/lib/query-client/index', () => ({}));",
      "import * as auth from '@/context/AuthContext';",
      "import notifications from '../context/NotificationContext';",
      "const client = require('@/lib/query-client') as typeof import('@/lib/query-client');",
      "jest.spyOn(jest.requireActual('@/context/AuthContext'), 'useAuth');",
      "const late = await import('@/context/NotificationContext');",
      "import auth = require('@/context/AuthContext');",
      "jest.mock('@/context/AuthContext/', () => ({}));",
    ].join("\n"), hits: 13 },
    spare: [
      "jest.mock('@/context/SocketContext', () => ({ ...jest.requireActual('@/context/SocketContext') }));",
      "jest.mock('@/context/AuthContextual', () => ({}));",
      "await renderApp(<Screen />, { user: { id: 'u1', username: 'Ana' } });",
      "import { useAuth, type AuthUser } from '@/context/AuthContext';",
      "const { useAuth } = require('@/context/AuthContext') as typeof import('@/context/AuthContext');",
    ].map((code) => ({ file: "tests/native/plant.test.tsx", code })),
  },
  {
    id: "native-mocks-name-their-module",
    why: "A module mock names its module in a literal, so a guard can tell what it replaces (docs/agents/traps.md § Where a forbidden-shape rule goes): write the path out instead of building it.",
    selector: `${JEST_MOCK} > :first-child:not(Literal, TemplateLiteral[expressions.length=0])`,
    files: ["tests/native/**/*.{ts,tsx}"],
    plant: { file: "tests/native/plant.test.tsx", code: [
      "const CONTEXT = '@/context/GameContext';",
      "jest.mock(CONTEXT, () => ({}));",
      "jest.doMock('@/context/' + 'SocketContext', () => ({}));",
      "jest.mock(`@/context/${name}`, () => ({}));",
      "jest.setMock(path.join('context', 'GameContext'), {});",
    ].join("\n"), hits: 4 },
    spare: [
      "jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));",
      "jest.doMock(`expo-asset`, () => ({}));",
    ].map((code) => ({ file: "tests/native/plant.test.tsx", code })),
  },
  {
    id: "table-renders-through-the-app",
    why: "The socket, the game contexts and the query client are the app's own (tests/native/harness/renderApp.tsx): online state arrives through socket().deliver('game:state', …), an offline table through renderApp's `offline` save. A typed slice fixture is only for a single-slice components/table leaf (D16).",
    selector: seamsOf({
      modules: "context\\x2F(SocketContext|GameContext|OnlineGameContext|onlineGameHooks|gameHooks|AppProviders)|([\\w-]+\\x2F)*onlineContextMock",
      packages: "@tanstack\\x2Freact-query",
    }),
    files: ["tests/native/**/*.{ts,tsx}"],
    plant: { file: "tests/native/plant.test.tsx", code: [
      "jest.mock('@/context/SocketContext', () => ({ useSocket: () => ({ socket }) }));",
      'jest.doMock("../../context/OnlineGameContext.tsx", () => ({}));',
      "jest.mock(`@/context/onlineGameHooks`, () => ({}));",
      "jest.mock('@/context/GameContext', () => ({}));",
      "jest.mock('@/context/gameHooks', () => ({}));",
      "jest.mock('./helpers/onlineContextMock', () => ({}));",
      "jest.mock('@tanstack/react-query', () => ({ ...jest.requireActual('@tanstack/react-query') }));",
      "jest.mock('@tanstack/react-query/build/modern/index.js', () => ({}));",
      "jest.mock('@/context/AppProviders', () => ({ AppProviders: ({ children }) => children }));",
      "jest.setMock('@/context/SocketContext', {});",
      "jest.doMock('../context/GameContext/index.tsx', () => ({}));",
      "jest.mock('@/context/OnlineGameContext.js', () => ({}));",
      "import * as sockets from '@/context/SocketContext';",
      "jest.spyOn(sockets, 'useSocket');",
      "const hooks = jest.requireActual('@/context/onlineGameHooks');",
      "jest.spyOn(require('@/context/GameContext'), 'useGameTable');",
      "const sockets = await import('@/context/SocketContext');",
      "import game = require('../context/GameContext');",
      "jest.mock('@/context/OnlineGameContext/', () => ({}));",
    ].join("\n"), hits: 18 },
    spare: [
      "jest.mock('@/context/SocketContextual', () => ({}));",
      "jest.mock('@tanstack/react-query-devtools', () => ({}));",
      "jest.mock('@/components/GameTable', () => ({}));",
      "await live.deliver('game:state', wire(ENDED, 0), () => {});",
      "import { useGameTable } from '@/context/GameContext';",
      "import { QueryClient } from '@tanstack/react-query';",
      "const { useGameTable } = await import('@/context/GameContext');",
      "import type { LocalTable } from '@/context/GameContext';",
      "jest.spyOn(lampControls, 'setTarget');",
    ].map((code) => ({ file: "tests/native/plant.test.tsx", code })),
  },
];

// eslint's --cache keys a plugin's results on its meta.version, so an unversioned guard edit would
// leave cached results standing.
// The selectors are built from other files too (CHANNEL_KEYS), so the registry's resolved values go in beside the source.
const version = require("node:crypto")
  .createHash("sha256")
  .update(require("node:fs").readFileSync(module.filename))
  .update(JSON.stringify(GUARDS.map(({ id, selector, files, ignores }) => [id, selector, files, ignores])))
  .digest("hex")
  .slice(0, 16);

const plugin = {
  meta: { name: "murlan", version },
  rules: Object.fromEntries(
    GUARDS.map((guard) => [
      guard.id,
      {
        meta: { type: "problem", schema: [] },
        create: (context) => {
          const report = (node) => context.report({ node, message: guard.why });
          return { [guard.selector]: report, ...guard.scoped?.(context, report) };
        },
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

module.exports = { GUARDS, CLIENT, plugin, guardBlocks };
