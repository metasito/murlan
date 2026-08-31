# #585 — the height a menu screen is given

The four `.dc.html` artboards and `canvas.json` here are the proposal the owner approved from;
they seed the canvas at https://claude.ai/code/artifact/2a86ec07-0cc3-4f40-898e-784c143c610c.
The seeded page itself is 2.4 MB of editor and is deliberately not committed — re-seed it with
`/design` from these files. `captures/` is what shipped.

## Reproducing the captures

```
MENU_HEIGHT_CAPTURE=docs/design/585-menu-height/captures \
  npx playwright test -c tests/e2e/playwright.config.ts menuHeight
```

That writes all four states of every screen the spec measures — `__phone-landscape`,
`__phone-portrait`, `__tablet-landscape`, `__tablet-portrait` — which is every capture in the
directory. The phone is `tests/e2e/helpers/phones.ts`'s iPhone 12 and its transpose; the tablet
is 1112×834 and 834×1112.

375×667, 430×932, 932×430 and 568×320 were swept once by hand while the change was being made,
and are not reproducible from a committed spec. The smallest of them found #621, which is a
defect this ticket did not introduce and does not fix.

## What the numbers were

`tests/e2e/menuHeight.spec.ts` prints one `HEIGHT` line per screen and orientation: where the
content ends at a phone height, and at a tablet height.

| Screen | before (phone → tablet) | after | the bar | after clears it by |
| --- | --- | --- | --- | --- |
| `/(online)` landscape | 322 → **322** | 338 → **554** | 500 | 54 |
| `/(online)` portrait | 569 → **569** | 666 → **800** | 667 | 133 |
| `/friends` landscape | 557 → **557** | 608 → **742** | 667 | 75 |
| `/friends` portrait | 557 → **557** | 751 → **974** | 890 | 84 |
| `/leaderboard` landscape | 392 → **392** | 392 → **765** | 709 | 56 |
| `/leaderboard` portrait | 392 → **392** | 775 → **1043** | 945 | 98 |
| `/(online)/room` landscape | 445 → 810 | unchanged | 751 | 59 |
| `/(online)/room` portrait | 820 → 1088 | unchanged | 1001 | 87 |

The *before* column is the spec run unchanged against `9c8cc5f`, this branch's merge base: six of
the eight fail there, each with the byte-identical bottom the ticket describes, and by 15–61%.

Every bar sits far enough under what the screen reaches that a font-metric change cannot trip it,
and far enough over the defect that the defect cannot hide under it. A check that goes red at
random gets disabled and then lies (#118).

`/(online)/room` was already elastic, so its two rows are identical on both sides of the diff.
That is the point of them: a suite where nothing passes says nothing about the ones that fail.

## Two of the audit's six screens are not this ticket

`/rules` (1885px of content) and `/(online)/profile` (1696px) render more than any window
here holds, so they scroll. An identical bottom there means *the same content*, not a void —
there is no slack to strand. `/rules`' scrolling is #587.

## Not confirmed on iOS

Chromium only, like the audit that produced the ticket (#205 has not landed).
