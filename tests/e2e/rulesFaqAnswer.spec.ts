// tests/e2e/rulesFaqAnswer.spec.ts — an opened FAQ answer shows all of its text.
//
// The answer used to animate `maxHeight` to a fixed 400 px under `overflow:
// hidden`, so the longest answer was cut off on a phone. Only a browser can say
// how tall the text ended up: react-test-renderer never runs flexbox.
import { test, expect } from "./fixtures";
import { openApp } from "./helpers/navigation";

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
