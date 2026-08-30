# The polish audit — captures and measurements (#57)

What this holds, and how to read it.

## The measurements

`content.txt` and `table.txt` are the raw output of the survey passes: one line per
(screen, viewport) and per (lamp state, size). The columns that carry the findings:

- `y=<top>..<bottom>(<n>%)` — the vertical extent of **content**, meaning text leaves and
  controls. Backgrounds are excluded on purpose: the felt is full-bleed, so a box that counts
  it reports every screen as using its whole viewport and no screen as having any slack.
- `x=<left>..<right>` and `wide=` — anything reaching past the viewport's own width, named.
- `emptyBand` — on the table, the vertical gap between the lowest seat plate and the top of
  the hand.

`NotificationBanner` never returns null; it parks at `y=-44` with nothing to say. Every
measurement here discards nodes whose bottom is at or above zero for that reason.

## The captures

Each is named `<screen>__<viewport>.png`. They are the evidence rows in the findings table
on the issue point at, kept here rather than pasted into a comment so they can be measured
again rather than re-described.

| Capture | What it is evidence for |
| --- | --- |
| `online-hub__tablet-landscape.png` | Content ends at y=360 of 834; the column divider runs the full height |
| `index__tablet-landscape.png` | The same stranding on the main menu |
| `leaderboard__tablet-landscape.png` | 46% of height used |
| `rules__phone-portrait.png` | The card-strength row ends flush at the edge with no sign it scrolls |
| `settings-modal__phone-portrait.png` | Two of five card-back names truncate |
| `result__phone-12.png` | The primary action sits away from where the rankings end |
| `table-lamp-bottom__tablet.png` | 349px empty band; 148px of unused width |
| `table-lamp-bottom__phone-12.png` | The same table at phone size, for comparison |
| `table-long-names__phone-12.png` | Long names truncate and initials fall back to two letters — a plan, not a defect |

## What was measured and dismissed

Recorded because a survey that only reports what it found invites the same three
hypotheses next time.

- **The hand sitting below the bottom edge is the design.** 29–33px on phones, 75–80px on
  tablets. The prototype's own hand is `26/90` of a card below the safe line, which is 33px
  at iPhone 12 card height (`tests/e2e/fixtures/prototype-table.html`).
- **The blank box on "Passa e gioca" is `phone-portrait-outline` itself**, not a missing
  glyph. `tests/e2e/helpers/glyphCoverage.ts` reports zero failures across `/`, `/lobby`,
  `/rules`, `/auth` and `/(online)/profile`.
- **The tablet-felt complaint is closed for the table.** At 1112×834 the table is 964×806 —
  97% of the viewport's height. What is left is the menu screens and the band inside the
  table, which are different findings.
