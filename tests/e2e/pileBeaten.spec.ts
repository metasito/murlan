// tests/e2e/pileBeaten.spec.ts — the beaten play is the lantern mockup's `.grp.prev`, on the views that flew.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { offlineGameSave, resumeSaved } from "./helpers/offlineSeed";
import { settled } from "./helpers/settle";
import { E2E_SUSPEND_AI_KEY } from "../../lib/storageKeys";

const VIEWPORT = { width: 844, height: 390 };
const LEAD = 2;
// Play runs down the seats. Singles only, each of Luan's over one of Besnik's: whatever Besnik leads, Luan beats.
const HOLDING = [
  ["5_hearts", "6_diamonds", "9_clubs"],
  ["4_clubs", "8_hearts", "J_spades"],
  ["3_clubs", "7_hearts", "10_spades"],
  ["5_spades", "6_hearts", "9_diamonds"],
];
const FIXTURE = resolve(__dirname, "fixtures/lantern-table/index.html");

function mockupPrev() {
  const css = readFileSync(FIXTURE, "utf8");
  const m = /\.grp\.prev\{transform:translateY\((-?[\d.]+)px\) rotate\((-?[\d.]+)deg\);filter:brightness\(([\d.]+)\)\}/.exec(css);
  if (!m) throw new Error("the fixture's .grp.prev rule changed shape: read it again before comparing");
  return { drop: Number(m[1]), rotateDeg: Number(m[2]), brightness: Number(m[3]) };
}

async function botPlays(page: Page) {
  await page.evaluate(() => (globalThis as unknown as { murlanBotMove: () => void }).murlanBotMove());
  await page.locator('[data-testid="flying-cards"]').waitFor({ state: "attached", timeout: 15_000 });
  await page.locator('[data-testid="flying-cards"]').waitFor({ state: "detached", timeout: 15_000 });
}

test("the beaten play turns and darkens as the mockup's, on the cards that landed", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const mockup = mockupPrev();
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const flew = new Set<Element>();
    (window as unknown as { __flew: Set<Element> }).__flew = flew;
    const sample = () => {
      document.querySelectorAll('[data-testid="flying-cards"] [data-testid="pile-card"]').forEach((el) => flew.add(el));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await page.addInitScript((key) => window.localStorage.setItem(key, "1"), E2E_SUSPEND_AI_KEY);
  await resumeSaved(page, baseURL!, offlineGameSave(4, undefined, LEAD, {}, HOLDING));
  await botPlays(page);
  await botPlays(page);
  await page.getByTestId("pile-prev-layer").waitFor({ state: "attached", timeout: 5_000 });
  await settled(page, 1_500, '[data-testid="pile-area"]');

  const seen = await page.evaluate(() => {
    const group = document.querySelector('[data-testid="pile-prev-layer"]')!;
    const style = getComputedStyle(group);
    const m = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    const flew = (window as unknown as { __flew: Set<Element> }).__flew;
    const cards = [...group.querySelectorAll('[data-testid="pile-card"]')];
    return {
      rotateDeg: (Math.atan2(m.b, m.a) * 180) / Math.PI,
      dx: m.e,
      drop: m.f,
      opacity: Number(style.opacity),
      filter: style.filter,
      cards: cards.length,
      landed: cards.filter((el) => flew.has(el)).length,
      shades: [...group.querySelectorAll('[data-testid="beaten-shade"]')].map((el) => {
        const s = getComputedStyle(el);
        return { color: s.backgroundColor, opacity: Number(s.opacity) };
      }),
    };
  });

  expect(seen.cards, "a card was played and beaten").toBeGreaterThan(0);
  expect(seen.landed, "the beaten cards are the views that flew").toBe(seen.cards);
  expect(Math.abs(seen.rotateDeg - mockup.rotateDeg), `turned ${seen.rotateDeg.toFixed(2)}deg`).toBeLessThan(1);
  expect(Math.abs(seen.drop - mockup.drop), `dropped ${seen.drop.toFixed(2)}pt`).toBeLessThan(1);
  expect(Math.abs(seen.dx), `drifted ${seen.dx.toFixed(2)}pt sideways`).toBeLessThan(1);
  expect(seen.opacity).toBe(1);
  expect(seen.filter).toBe("none");
  expect(seen.shades, "one shade per card").toHaveLength(seen.cards);
  for (const s of seen.shades) {
    expect(s.color).toBe(`rgba(0, 0, 0, ${+(1 - mockup.brightness).toFixed(2)})`);
    expect(s.opacity).toBe(1);
  }
});
