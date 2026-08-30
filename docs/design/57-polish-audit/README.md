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

`online-table.txt` is the row this survey originally had to leave blank (#590), and it is the
one file here a command reproduces:

```
npx playwright test -c tests/e2e/playwright.config.ts onlineTableSurvey
```

It registers, creates a room, fills it with bots and photographs the dealt table at the four
viewports above — and measures the *offline* table beside it each time, because both screens
render one `<GameTable>`. Its columns are `table.txt`'s plus `emptyBand`, the number finding 3
is about, and `wide`, read twice a second and a half apart so the light pass a played flush
throws across the felt is not mistaken for content hanging off the screen.

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
| `settings-sheet__tablet-landscape.png` vs `__phone-12.png` | The same void, inside the in-game sheet: ~70px on a phone, ~380px on a tablet |
| `online-lobby__tablet-landscape.png` | The online lobby, for the same reason |
| `online-table__phone-se.png` … `__tablet.png` | The started online table at all four viewports — the row this survey could not fill |

## The one number behind most of it

Six screens render their content at a **byte-identical height** whether the window is 390px
tall or 834px — `/(online)` and `/(online)/room` both end at y=338, friends at 557,
leaderboard at 404, profile at 1696, rules at 1885. The extra 444px becomes a void.

The cause is one line, repeated: every menu screen reads the window height exactly once, and
only ever to compute a boolean.

```
app/index.tsx:654              const isLandscape = W > H;
app/lobby.tsx:131              const isLandscape = W > H;
app/(online)/index.tsx:42      const isLandscape = W > H;
app/(online)/quickmatch.tsx:95 const isLandscape = W > H;
app/(online)/room.tsx:337      const isLandscape = W > H;
```

Nothing consults *how much* height there is. A screen fills a tall window only when it
happens to contain a `flex: 1` child that absorbs the slack — which is why `/`, `/lobby`
and `/quickmatch` reflow (368→798, 358→802, 366→810) and the rest do not.

## The online table (#590)

Measured, not assumed from the offline one. At all four viewports the two tables lay out to
byte-identical numbers — same felt box, same card, same empty band — which is what the check
in `tests/e2e/onlineTableSurvey.spec.ts` now holds them to, so the online screen cannot drift
away unwatched.

`handSlot` is the box the fan gives one hand card — full height, and only the width the card
beside it leaves uncovered. It is not `table.txt`'s `card`, which is a card on the felt.

| Viewport | Table | `handSlot` | `emptyBand` |
| --- | --- | --- | --- |
| 568×320 | 496×309 | 30×90 | 94 |
| 844×390 | 769×377 | 44×111 | 114 |
| 956×440 | 878×425 | 49×125 | 130 |
| 1112×834 | 964×806 | 50×233 | 270 |

- **Finding 3 applies to the online table.** 270px of the tablet's 806px table is the band
  between the lowest seat and the hand, against 94px of 309px on the smallest phone. It is
  the same table, so it is the same finding, and fixing it fixes both.
- **The stretch class does not.** The six menu screens render the same content height at 390
  and 834 because nothing asks how much height there is. The table asks: its felt, its cards
  and its bands all grow with the window (309 → 806, 90 → 233). The void on a tablet table is
  the empty band, which is finding 3, and not the stretch class wearing its clothes.
- **Nothing on the online table renders past the screen's own width** at any of the four.
  What does, briefly, is the flush's light pass, which is 2.2× the table by construction
  (`Sweep`, `components/table/moments.tsx`).

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
- **Creating a room is not slow, and it never hung.** Register, create, fill with bots and
  arrive at a dealt table takes 1.3–1.7s at every one of the four viewports, 568×320
  included. The survey's own harness was never committed — only its output was — so the run
  that hung cannot be re-run, and that is the finding: nothing here could reach the online
  table, and nothing here could diagnose why. The one mechanism that reproduces the stall is
  a harness's, not the product's: without the tutorial answer seeded, the title screen pushes
  `/tutorial` out from under whatever clicked. Measured — a run without the seed stalled
  there for its whole two-minute budget; the same run with it reached the room in 1.4s.
  `tests/onlineTableHarness.test.ts` now refuses a suite file that opens the app's root
  without it.
