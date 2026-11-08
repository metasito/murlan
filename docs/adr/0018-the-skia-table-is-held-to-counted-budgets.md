# 0018. The Skia table is held to counted budgets, and to no time budget

**Status:** Accepted
**Date:** 2026-11-08

## Context

S5 of `docs/research/2026-11-07-stabilization/REPORT.md` asks for the speed of the renderer
players get to block a pull request: the Skia felt, motion on, 4x CPU throttle, with budgets that
cannot loosen with the code they judge (rule 52). `tests/e2e/skiaPerf.spec.ts` measures two
240-frame windows on the virtual clock: the settled table (**rest**), and the viewer's throw with
three bot moves (**turn**).

Its first version also gated script ms per frame, from CDP's `ScriptDuration`. Review of #1996
planted four regressions in `components/table/feltCanvas.tsx`:

- a style write on every card each frame;
- `bakeCloth` each frame;
- a `setState` each frame;
- about 1.5M `Math.sin` each `requestAnimationFrame`.

The fourth moved turn script ms from 17.4 to 17.8. Under the virtual clock, a frame's callbacks run
inside `page.evaluate`, and `ScriptDuration` does not see that work. It was also the only
wall-time threshold, which the reasons in `docs/WEB-PERF.md` § Why this recorder does not gate CI
rule out. The first plant passed every budget. The second failed only because it exhausted the
WebGL contexts, so the felt stopped drawing: its 240 offscreen draws and 240 `readPixels` showed in
no gated count.

## Decision

Decided by the coordinator, under the owner's standing authority for long-term-optimal decisions.
The owner can overrule it in a pull request that touches only the targets.

1. **Only counts gate.** Each window is held to:
   - WebGL draws per frame on the page's canvases;
   - draws on canvases outside the document;
   - `readPixels` calls;
   - style writes inside a card's view.

   At rest, the felt is also held to the number of frames it drew in. Script ms, task ms and
   long tasks go into the `skia perf at 4x` annotation and are not gated.
2. **The budgets**, set in `tests/e2e/helpers/skiaPerfBudgets.ts`, against head on 2026-11-08:

   | Window | Count | Budget | Measured | Basis |
   |---|---|---|---|---|
   | rest | felt frames, of 240 | 96 | 86 every run | 0.4 of the window, the ceiling `tableAtRest.spec.ts` uses |
   | rest | WebGL draws per frame | 5.5 | 4.92 every run | about 10% over |
   | rest | offscreen draws | 0 | 0 | a settled table bakes nothing |
   | rest | `readPixels` | 0 | 0 | a settled table reads nothing back |
   | rest | card style writes | 0 | 0 | a settled table writes no card style |
   | turn | WebGL draws per frame | 38 | 34.49 – 34.65 | about 10% over the highest |
   | turn | offscreen draws | 8 | 4 | twice the measurement; a bake per frame is 240 |
   | turn | `readPixels` | 0 | 0 | nothing reads back through a turn |
   | turn | card style writes | 18000 | 16320 – 16330 | about 10% over; a write per card per frame adds about 3400 |

3. **A pure-CPU regression is not gated.** A frame that does more JavaScript without drawing,
   reading back or writing a style passes. That covers more work per frame, but not more frames,
   draws or writes. A `setState` each frame whose drawn output does not change is such a
   regression: Skia commits the same props without drawing. On a shared runner the only measure of such work is wall time, and decision 1
   rules that out. Script ms stays in the annotation for a person to compare.
4. **DPR 1 only.** At DPR 3, SwiftShader had not finished the rest window after six minutes.

## Consequences

- The budgets move only in their own pull request, which cites a decision moving them (rule 52).
  `.github/CODEOWNERS` routes both files to the owner.
- The counts are near-deterministic but not exact. Turn draws per frame vary between 34.49 and
  34.65, and card writes vary by about 10 between runs. Each budget leaves room for that jitter, so
  a planted regression still has to clear the headroom before it fails.
