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

1. **Only counts gate, and every count the counters keep.** Each window is held to:
   - WebGL draws per frame on the page's canvases;
   - 2D draws (clears, image draws, fills) on the page's canvases;
   - draws on canvases outside the document;
   - `readPixels` calls;
   - style writes anywhere under `game-root`.

   Through the turn, style writes inside a card's view are also held, between a floor of half the
   budget and the budget. The felt's drawn frames have a ceiling at rest and a floor through the
   turn. Script ms, task ms and long tasks go into the `skia perf at 4x` annotation and are not
   gated. A second review of #1996 planted a style write on every seat disc each frame, and a
   full-table 2D canvas drawn each frame. Both passed a gate that held only card writes and WebGL
   draws, although the counters had seen them.
2. **The budgets**, set in `tests/e2e/helpers/skiaPerfBudgets.ts`, against head on 2026-11-08.
   Measured is the range a count took over the review's seven unplanted runs and this pull
   request's three, and over its planted runs whose plant does not touch that count:

   | Window | Count | Budget | Measured | Basis |
   |---|---|---|---|---|
   | rest | felt frames, of 240 | 89 | 86 every run | about 3% over |
   | rest | WebGL draws per frame | 5.1 | 4.92 every run | about 3% over |
   | rest | 2D draws | 1580 | 1537 every run | about 3% over; the particles draw in 120 of the 240 frames |
   | rest | offscreen draws | 0 | 0 | a settled table bakes nothing |
   | rest | `readPixels` | 0 | 0 | a settled table reads nothing back |
   | rest | style writes | 0 | 0 | a settled table writes no style |
   | turn | WebGL draws per frame | 35.5 | 34.49 – 34.65 | about 3% over the highest |
   | turn | 2D draws | 11850 | 11509 – 11516 | about 3% over the highest |
   | turn | offscreen draws | 4 | 4 every run | the four bakes the turn makes; one more fails |
   | turn | `readPixels` | 0 | 0 | nothing reads back through a turn |
   | turn | style writes | 17700 | 17146 – 17222 | about 3% over the highest |
   | turn | card style writes | 16800, floor 8400 | 16253 – 16329 | about 3% over the highest |

   About 3% because the counts are near-deterministic: the widest spread, turn card writes, is
   under 0.5%. Wider headroom lets real regressions through: a style write on every seat disc
   each frame adds about 650 turn style writes, against 478 of headroom, and the first gate's
   10% would have passed it.

3. **A pure-CPU regression is not gated.** A frame that does more JavaScript with no extra draw,
   readback or style write passes. A `setState` each frame whose drawn output does not change is such a
   regression: Skia commits the same props without drawing. On a shared runner the only measure of
   such work is wall time, and decision 1 rules that out. Script ms stays in the annotation for a
   person to compare.
4. **DPR 1 only.** At DPR 3, SwiftShader had not finished the rest window after six minutes.

## Consequences

- The budgets move only in their own pull request, which cites a decision moving them (rule 52).
  `.github/CODEOWNERS` routes both files to the owner.
- The counts are near-deterministic but not exact: turn card writes vary by 76 between runs, and
  turn draws per frame by 0.16. Each budget leaves about 3% for that jitter, so a regression smaller
  than that passes.
