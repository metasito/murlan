// lib/ticketPipeline/verifyPlan.ts
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(process.argv[2] ?? "[]");
  process.stdout.write(JSON.stringify(pickVerifyChecks(input)));
}
