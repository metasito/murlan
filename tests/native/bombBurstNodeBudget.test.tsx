// tests/native/bombBurstNodeBudget.test.tsx — the spark burst's own node
// budget (#765): "~24 nodes... that was the prototype's figure and it is the
// budget", and "a test pins the count rather than trusting the
// implementation to stay honest." A source scan can only read `SPARK_COUNT`;
// it cannot see what mounting `BombBurst` actually costs once react-native-svg's
// own wrapper nodes (`RNSVGSvgView`, `RNSVGGroup`) are folded in, so this
// mounts the real tree and counts what react-test-renderer actually built.
//
// `RNSVGDefs` and `RNSVGRadialGradient` are excluded from the count: they are
// gradient *definitions*, consumed by `RNSVGRect`'s own paint rather than
// painting anything themselves — the prototype's own CSS `radial-gradient()`
// has no DOM node for either, so counting them here would be penalising this
// build for a definition its own web original never had to spend a node on.
import { describe, it, expect } from "@jest/globals";
import React from "react";
import { render } from "@testing-library/react-native";
import { BombBurst } from "@/components/table/moments";
import { SPARK_COUNT } from "@/components/gameTableModel";

/** The prototype's own figure (#765's issue body). */
const NODE_BUDGET = 24;

const DEFINITION_ONLY = new Set(["RNSVGDefs", "RNSVGRadialGradient"]);

function countPaintNodes(node: unknown): number {
  if (node === null || node === undefined || typeof node === "string") return 0;
  const arr = Array.isArray(node) ? node : [node];
  let total = 0;
  for (const n of arr) {
    if (n === null || n === undefined || typeof n === "string") continue;
    const type = String((n as { type?: unknown }).type);
    if (!DEFINITION_ONLY.has(type)) total += 1;
    const children = (n as { children?: unknown }).children;
    if (children) total += countPaintNodes(children);
  }
  return total;
}

describe("the bomb burst's own node budget (#765)", () => {
  it("stays within the prototype's ~24-node figure", async () => {
    const r = await render(<BombBurst trigger={1} scale={1} flareKind="brief" />);

    const count = countPaintNodes(r.toJSON());
    expect(count).toBeLessThanOrEqual(NODE_BUDGET);
    // Not vacuous: a burst that rendered nothing would also stay under budget.
    expect(count).toBeGreaterThan(SPARK_COUNT);

    await r.unmount();
  });

  it("the spark count does not scale with which flare fired — the tier decides whether, not how many", async () => {
    const brief = await render(<BombBurst trigger={1} scale={1} flareKind="brief" />);
    const briefCount = countPaintNodes(brief.toJSON());
    await brief.unmount();

    const settle = await render(<BombBurst trigger={1} scale={1} flareKind="settle" />);
    const settleCount = countPaintNodes(settle.toJSON());
    await settle.unmount();

    expect(briefCount).toBe(settleCount);
  });
});
