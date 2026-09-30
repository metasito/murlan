import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint } from "eslint";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NOTICES = "components/table/notices";
const SYNTAX = "no-restricted-syntax";
const IMPORTS = "@typescript-eslint/no-restricted-imports";

const eslint = new ESLint({ cwd: ROOT });

const PLANT = [
  `  import { View } from "react-native";`,
  `  import { Radius, Scrim } from "@/lib/theme";`,
  `  import { NoticePalette } from "../../../lib/tokens";`,
  `  export const Plate = () => (`,
  `    <View style={{ backgroundColor: Scrim.heavy, borderColor: NoticePalette.pill.neutral.edge, borderWidth: 1, borderRadius: Radius.full, shadowOpacity: 0.3 }} />`,
  `  );`,
].join("\n");

const messages = async (code: string, file: string) => {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  return result.messages;
};
const firing = async (code: string, file: string) => (await messages(code, file)).map((m) => m.ruleId);

test("a hand-built plate in the notices directory is refused by both rules", async () => {
  const found = await messages(PLANT, `${NOTICES}/__plant.tsx`);
  assert.equal(found.filter((m) => m.ruleId === SYNTAX).length, 5, "the fill, edge, width, radius and shadow");
  const imports = found.filter((m) => m.ruleId === IMPORTS).map((m) => m.message);
  for (const name of ["Radius", "Scrim", "NoticePalette"]) {
    assert.ok(imports.some((m) => m.includes(`'${name}'`)), `importing ${name} is not refused: ${imports.join(" | ")}`);
  }
});

test("the same plate outside the notices directory is refused only its palette import", async () => {
  const found = await messages(PLANT, "components/table/__plant.tsx");
  assert.deepEqual(found.filter((m) => m.ruleId === SYNTAX), []);
  const imports = found.filter((m) => m.ruleId === IMPORTS).map((m) => m.message);
  assert.ok(imports.length > 0 && imports.every((m) => m.includes("'NoticePalette'")), imports.join(" | "));
});

test("a string-keyed paint property and a namespace import are refused in the notices directory", async () => {
  const found = await firing(
    [`  import * as Theme from "@/lib/theme";`, `  export const s = { "backgroundColor": Theme.Colors.bg, "borderRadius": 3 };`].join("\n"),
    `${NOTICES}/__plant.tsx`,
  );
  assert.equal(found.filter((r) => r === SYNTAX).length, 2, found.join(", "));
  assert.ok(found.includes(IMPORTS), found.join(", "));
});

const reads = async (code: string, file = "components/table/__plant.tsx") => (await firing(code, file)).includes(IMPORTS);

test("TableNotice is the one reader of the notice palette, however it is reached", async () => {
  assert.ok(await reads(`  import { NoticePalette } from "@/lib/theme";\n  export const p = NoticePalette;`));
  assert.ok(await reads(`  import * as Theme from "@/lib/theme";\n  export const p = Theme.NoticePalette;`));
  assert.ok(await reads(`  export { NoticePalette } from "@/lib/tokens";`));
  assert.ok(await reads(`  import { NoticePalette } from "../../lib/tokens.ts";\n  export const p = NoticePalette;`));
  assert.ok(
    await reads(`  import { type NoticePalette } from "@/lib/theme";\n  import { NoticePalette as P } from "@/lib/tokens";\n  export const p: typeof NoticePalette = P;`),
    "a type-only import does not exempt the file's value import",
  );
  assert.ok(!(await reads(`  import { type NoticePalette } from "@/lib/theme";\n  export type P = typeof NoticePalette;`)));
  assert.ok(!(await reads(`  import { NoticePalette } from "@/lib/theme";\n  export const p = NoticePalette;`, "components/table/TableNotice.tsx")));
});

test("the palette's reader and the model lint clean", async () => {
  const results = await eslint.lintFiles(["components/table/TableNotice.tsx", "components/table/noticeModel.ts"].map((f) => path.join(ROOT, f)));
  assert.deepEqual(results.flatMap((r) => r.messages.map((m) => `${path.basename(r.filePath)}:${m.line} ${m.message}`)), []);
});

test("the notices directory keeps the base token rules", async () => {
  const rules = await firing(`  export const s = { padding: 7, color: "Colors.gold" };`, `${NOTICES}/__plant.tsx`);
  assert.equal(rules.filter((r) => r === SYNTAX).length, 2, rules.join(", "));
});

test("the notices directory is non-empty and its real files are clean", async () => {
  const files = readdirSync(path.join(ROOT, NOTICES)).filter((f) => /\.tsx?$/.test(f));
  assert.ok(files.length > 0, `${NOTICES} holds no file for the rule to guard`);
  const results = await eslint.lintFiles(files.map((f) => path.join(ROOT, NOTICES, f)));
  const refused = results.flatMap((r) =>
    r.messages.filter((m) => m.ruleId === SYNTAX || m.ruleId === IMPORTS).map((m) => `${path.basename(r.filePath)}:${m.line} ${m.message}`),
  );
  assert.deepEqual(refused, []);
});
