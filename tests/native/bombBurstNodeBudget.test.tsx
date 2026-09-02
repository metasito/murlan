// tests/native/bombBurstNodeBudget.test.tsx — the spark burst's own node
// budget (#765): "~24 nodes... that was the prototype's figure and it is the
// budget", and "a test pins the count rather than trusting the
// implementation to stay honest." A source scan can only read `SPARK_COUNT`;
// it cannot see what mounting `BombBurst` actually costs, so this mounts the
// real tree and counts what react-test-renderer actually built. `Flare` and
// `LampLift` are a plain filled+shadowed circle rather than an `<Svg>` (a
// blind critique on #765's own review found that shape's `transform: scale`
// wrapping an `<Svg>` unverifiable on native — see `moments.tsx`'s own
// comment), so every node here is a paint node; there is no gradient-definition
// bookkeeping left to exclude.
import { describe, it, expect } from "@jest/globals";
import React from "react";
import { render } from "@testing-library/react-native";
import { BombBurst } from "@/components/table/moments";
import { SPARK_COUNT } from "@/components/gameTableModel";

/** The prototype's own figure (#765's issue body). */
const NODE_BUDGET = 24;

function countNodes(node: unknown): number {
  if (node === null || node === undefined || typeof node === "string") return 0;
  const arr = Array.isArray(node) ? node : [node];
  let total = 0;
  for (const n of arr) {
    if (n === null || n === undefined || typeof n === "string") continue;
    total += 1;
    const children = (n as { children?: unknown }).children;
    if (children) total += countNodes(children);
  }
  return total;
}

type TestJson = { type: string; props?: Record<string, unknown>; children?: unknown };

/** Depth-first search for the first node carrying this `testID`. */
function findByTestID(node: unknown, testID: string): TestJson | null {
  if (node === null || node === undefined || typeof node === "string") return null;
  const arr = Array.isArray(node) ? node : [node];
  for (const n of arr) {
    if (n === null || n === undefined || typeof n === "string") continue;
    const t = n as TestJson;
    if (t.props?.testID === testID) return t;
    const found = findByTestID(t.children, testID);
    if (found) return found;
  }
  return null;
}

describe("the bomb burst's own node budget (#765)", () => {
  it("stays within the prototype's ~24-node figure", async () => {
    const r = await render(<BombBurst trigger={1} scale={1} flareKind="brief" />);

    const count = countNodes(r.toJSON());
    expect(count).toBeLessThanOrEqual(NODE_BUDGET);
    // Not vacuous: a burst that rendered nothing would also stay under budget.
    expect(count).toBeGreaterThan(SPARK_COUNT);

    await r.unmount();
  });

  it("the spark count does not scale with which flare fired — the tier decides whether, not how many", async () => {
    const brief = await render(<BombBurst trigger={1} scale={1} flareKind="brief" />);
    const briefCount = countNodes(brief.toJSON());
    await brief.unmount();

    const settle = await render(<BombBurst trigger={1} scale={1} flareKind="settle" />);
    const settleCount = countNodes(settle.toJSON());
    await settle.unmount();

    expect(briefCount).toBe(settleCount);
  });

  it("the flare is layered, not a single flat-filled disc — a second critique's own finding", async () => {
    const r = await render(<BombBurst trigger={1} scale={1} flareKind="brief" />);

    const flare = findByTestID(r.toJSON(), "bomb-flare");
    const layers = countNodes(flare?.children);
    // A flat fill (the shape the critique rejected) is one node with no
    // children at all; this only holds once there is a real falloff to count.
    expect(layers).toBeGreaterThanOrEqual(2);

    await r.unmount();
  });
});
