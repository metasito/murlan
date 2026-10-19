import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint } from "eslint";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const eslint = new ESLint({ cwd: ROOT });

async function firing(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  assert.deepEqual(result!.messages.filter((m) => m.fatal), [], `not parsed at ${file}`);
  return result!.messages.map((m) => m.ruleId ?? "").filter((id) => id.startsWith("murlan/"));
}

const CASES = [
  { file: "modules/x/index.ts", code: 'import { AudioContext } from "react-native-audio-api";', rule: "murlan/audio-engine-owner", fires: true },
  { file: "modules/x/index.ts", code: 'import { type AudioContext } from "react-native-audio-api";', rule: "murlan/audio-engine-owner", fires: false },
  { file: "components/x.tsx", code: 'import { play } from "../lib/device/audioEngine.ts";', rule: "murlan/feedback-owner", fires: true },
  { file: "components/x.tsx", code: 'const api = import("react-native-audio-api");', rule: "murlan/audio-engine-owner", fires: true },
  { file: "lib/device/audioEngine.ts", code: 'import { AudioContext } from "react-native-audio-api";', rule: "murlan/feedback-owner", fires: false },
  { file: "shared/x.ts", code: 'import type { TranslationKey } from "../lib/i18n";', rule: "murlan/shared-no-client", fires: true },
  { file: "shared/x.ts", code: 'import type { Card } from "../lib/game/gameEngine";', rule: "murlan/shared-no-client", fires: false },
  { file: "lib/game/rating.ts", code: 'import type { TranslationKey } from "../i18n";', rule: "murlan/game-no-client-i18n", fires: true },
];

for (const { file, code, rule, fires } of CASES) {
  test(`${file}: ${code} ${fires ? "is refused by" : "passes"} ${rule}`, async () => {
    const config = (await eslint.calculateConfigForFile(path.join(ROOT, file))) as { rules?: Record<string, unknown> };
    const level = config.rules?.[rule];
    assert.equal(Array.isArray(level) ? level[0] : level, 2, `${rule} does not run at ${file}`);
    assert.deepEqual(await firing(code, file), fires ? [rule] : []);
  });
}
