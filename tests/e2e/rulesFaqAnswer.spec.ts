// tests/e2e/rulesFaqAnswer.spec.ts — an opened FAQ answer shows all of its text.
//
// The answer used to animate maxHeight to a fixed 400 px under overflow:
// hidden, so the longest answer was cut off on a phone. Only a browser can say
// how tall the text ended up: react-test-renderer never runs flexbox.
import { test, expect } from "./fixtures";
import { openApp } from "./helpers/navigation";
import { it as italian } from "../../locales/it.ts";

const OLD_CAP_PX = 400;
const ANSWER_LINE_PX = 20;

/** The page is served in Italian; its longest answer is the one the old cap clipped first. */
const longest = Object.entries(italian)
  .filter(([key]) => /^rules\.faq\.a\d+$/.test(key))
  .map(([key, text]) => ({ n: Number(key.replace("rules.faq.a", "")), chars: text.length }))
  .reduce((a, b) => (b.chars > a.chars ? b : a));

const PHONES = [
  { name: "iPhone SE portrait", width: 375, height: 667 },
  { name: "iPhone 12 portrait", width: 390, height: 844 },
];

for (const vp of PHONES) {
  test(`every opened FAQ answer is fully visible on ${vp.name}`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openApp(page, baseURL!);
    await page.goto(`${baseURL}/rules`);
    await expect(page.getByText("GUIDA AL GIOCO")).toBeVisible();

    const answers = page.locator('[data-testid^="faq-answer-"]');
    const count = await answers.count();
    expect(count, "the FAQ should render its answers").toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const answer = page.getByTestId(`faq-answer-${i}`);
      await answer.locator("xpath=preceding-sibling::*[1]").scrollIntoViewIfNeeded();
      await answer.locator("xpath=preceding-sibling::*[1]").click();

      await expect
        .poll(
          () =>
            answer.evaluate((el) => {
              const content = el.firstElementChild as HTMLElement;
              return Math.round(el.getBoundingClientRect().height) - Math.round(content.scrollHeight);
            }),
          { message: `answer ${i} must be as tall as its text` },
        )
        .toBeGreaterThanOrEqual(0);
    }
  });
}

test("a collapsed FAQ answer is taken out of the accessibility tree", async ({ page, baseURL }) => {
  await openApp(page, baseURL!);
  await page.goto(`${baseURL}/rules`);
  await expect(page.getByText("GUIDA AL GIOCO")).toBeVisible();

  const first = page.getByTestId("faq-answer-0");
  await expect(first).toHaveAttribute("aria-hidden", "true");
  await first.locator("xpath=preceding-sibling::*[1]").click();
  await expect(first).not.toHaveAttribute("aria-hidden", "true");
});

test(`the longest answer (a${longest.n}, ${longest.chars} chars) is taller than the old ${OLD_CAP_PX}px cap and shows whole`, async ({ page, baseURL }) => {
  // 320px is the narrowest phone: the text column is about 240px, so roughly 36 characters a line and
  // ceil(chars / 36) lines of 20px. Past 20 lines that is past 400px, which the old cap cut off.
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page, baseURL!);
  await page.goto(`${baseURL}/rules`);
  await expect(page.getByText("GUIDA AL GIOCO")).toBeVisible();

  const answer = page.getByTestId(`faq-answer-${longest.n - 1}`);
  const question = answer.locator("xpath=preceding-sibling::*[1]");
  await question.scrollIntoViewIfNeeded();
  await question.click();

  await expect
    .poll(() => answer.evaluate((el) => Math.round((el.firstElementChild as HTMLElement).scrollHeight)), {
      message: `${longest.chars} chars at ${ANSWER_LINE_PX}px a line must wrap past ${OLD_CAP_PX}px (${OLD_CAP_PX / ANSWER_LINE_PX} lines) at 320px wide, or this test is checking nothing`,
    })
    .toBeGreaterThan(OLD_CAP_PX);
  await expect
    .poll(() => answer.evaluate((el) => Math.round(el.getBoundingClientRect().height - (el.firstElementChild as HTMLElement).scrollHeight)), {
      message: "the opened answer's box must be as tall as its text",
    })
    .toBeGreaterThanOrEqual(0);
});
