# #585 — the height a menu screen is given

The canvas seeded here (`menu-height-on-a-tablet.html`, from the four `.dc.html` artboards
and `canvas.json`) is the proposal the owner approved from; `captures/` is what shipped.

## Reproducing the captures

```
MENU_HEIGHT_CAPTURE=docs/design/585-menu-height/captures \
  npx playwright test -c tests/e2e/playwright.config.ts menuHeight
```

That writes the `__tablet-landscape` / `__tablet-portrait` pair for every screen the spec
measures. The handset captures beside them came from the same spec run against the phone
sizes in `tests/e2e/helpers/phones.ts` plus 375×667 and 430×932.

## What the numbers were

`tests/e2e/menuHeight.spec.ts` prints one `HEIGHT` line per screen and orientation: where the
content ends at a phone height, and at a tablet height.

| Screen | before (phone → tablet) | after |
| --- | --- | --- |
| `/(online)` landscape | 322 → **322** | 338 → **554** |
| `/(online)` portrait | 569 → **569** | 666 → **800** |
| `/friends` landscape | 557 → **557** | 608 → **742** |
| `/friends` portrait | 557 → **557** | 751 → **974** |
| `/leaderboard` landscape | 392 → **392** | 392 → **765** |
| `/leaderboard` portrait | 392 → **392** | 775 → **1043** |
| `/(online)/room` | 445 → 810 | unchanged |

`/(online)/room` was already elastic and is in the spec as the control: a suite where nothing
passes says nothing about the ones that fail.

## Two of the audit's six screens are not this ticket

`/rules` (1885px of content) and `/(online)/profile` (1696px) render more than any window
here holds, so they scroll. An identical bottom there means *the same content*, not a void —
there is no slack to strand. `/rules`' scrolling is #587.

## Not confirmed on iOS

Chromium only, like the audit that produced the ticket (#205 has not landed).
