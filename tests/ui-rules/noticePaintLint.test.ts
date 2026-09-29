import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

test("the same plate outside the notices directory draws neither rule", async () => {
  const rules = await firing(PLANT, "components/table/__plant.tsx");
  assert.deepEqual(rules.filter((r) => r === SYNTAX || r === IMPORTS), []);
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

test("TableNotice is the one reader of the notice palette", () => {
  const readers: string[] = [];
  for (const dir of ["app", "components", "context", "lib"]) {
    for (const f of readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })) {
      if (!/\.tsx?$/.test(f)) continue;
      const rel = `${dir}/${f.split(path.sep).join("/")}`;
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      if (/import\s+\{[^}]*\bNoticePalette\b[^}]*\}\s+from/.test(src) && !/import\s+\{[^}]*\btype NoticePalette\b/.test(src)) readers.push(rel);
    }
  }
  assert.deepEqual(readers, ["components/table/TableNotice.tsx"]);
});
