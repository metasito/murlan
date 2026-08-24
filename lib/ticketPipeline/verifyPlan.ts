// lib/ticketPipeline/verifyPlan.ts
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASELINE = `node --test "tests/**/*.test.ts"`;

const RULES: { pattern: RegExp; command: string }[] = [
  { pattern: /^components\//, command: "npx jest components tests" },
  { pattern: /^app\//, command: "npx playwright test tests/e2e" },
  { pattern: /locale|locales\//, command: `node --test tests/i18n.test.ts` },
  {
    pattern: /^lib\/theme\.ts$/,
    command: `node --test tests/tokenRoles.test.ts tests/contrast.test.ts tests/cosmetics.test.ts`,
  },
  { pattern: /gameTableModel|handLayout|cardFaceModel/, command: `node --test tests/gameTableModel.test.ts` },
];

export function pickVerifyChecks(filesTouched: string[]): string[] {
  const checks = new Set<string>([BASELINE]);
  for (const file of filesTouched) {
    for (const rule of RULES) {
      if (rule.pattern.test(file)) checks.add(rule.command);
    }
  }
  return Array.from(checks);
}

// Input arrives on stdin, never as an argv token: a caller's shell layer collapses the `\\`
// that JSON.stringify emits for a literal backslash, which makes the payload unparseable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(readFileSync(0, "utf8").trim() || "[]");
  process.stdout.write(JSON.stringify(pickVerifyChecks(input)));
}
