# A labelled control exposes one accessible node — the check, and the 55 controls

Design for #492. Supersedes the shape proposed in the issue body, on evidence
the issue did not have.

## What the defect actually is

The issue, and CLAUDE.md's invariant, say a labelled control whose children stay
in the accessibility tree is announced twice. That is right about the tree and
wrong about which platform pays for it. Measured rather than reasoned:

**iOS is not affected.** `Pressable` defaults `accessible` to true;
`RCTViewComponentView.mm:348` assigns it straight to
`isAccessibilityElement`, and a UIKit view that answers YES to that is a leaf —
UIKit never enumerates its subviews. The children are unreachable on iOS
whether or not anyone hid them.

**Web is affected, and only web.** react-native-web's forwarded-prop allow-list
(`modules/forwardedProps/index.js`) carries no `accessible` at all, so the prop
reaches the DOM as nothing. The control renders `div[role=…][aria-label]` with
its children fully live beneath it.

Chromium's own accessibility tree, read through
`Accessibility.getFullAXTree`, on `/lobby` as it stands today:

```
radio "Partita: Primo a 7 punti"
  generic ""
    StaticText "Partita"
  generic ""
    StaticText "Primo a 7 punti"
button "Inizia Partita"          <- MenuButton
  generic ""
    StaticText "Inizia Partita"
```

Not `ignored`. Live nodes, carrying the words the control is already named
with. The same probe on `/rules`, which #393 fixed:

```
button "Inizia il tutorial, una manche guidata"
button "Qual è l'obiettivo del gioco?"
button "Indietro"
```

Every one a leaf. So the property is real, the fix demonstrably achieves it,
and both halves of that are measurements rather than arguments.

## What this corrects in the issue

The issue states the browser cannot find these. That is true of
`page.getByText()` and of `toMatchAriaSnapshot`, both of which #393 tried
against a seeded child and both of which stayed green — and false of the full
AX tree, which distinguishes the two shapes exactly. The claim was too broad,
and it was mine.

It also means the count in the issue is wrong. A line-window scan found 20
across 12 files; a tag-aware scan that tracks hidden ancestors finds
**55 across 17 files**.

## The shape of the check

The issue proposed `blockingOverlays.test.ts`'s classify-or-fail registry. At
55 entries that is the wrong shape: a registry earns its keep when most
candidates are legitimate and a human must rule on each. Here almost every
candidate is the same defect with the same one-prop fix, so the registry would
be a list of 50 bugs wearing the costume of a decision.

Inverted instead:

- **Fix the candidates.** Hiding a control's own face is correct wherever the
  label already carries the words, which is nearly all of them.
- **The scan fails by default**, naming the file, line and offending child.
- **One small exception list**, for controls where a child must stay reachable,
  each with its reason. It is expected to hold single digits; empty is the goal.

Two checks, each doing only what it can:

1. `tests/a11yCollapse.test.ts` — a node scan over `app/` and `components/`.
   Total coverage, no runtime, runs in `agent:check`, and it is what stops the
   next one landing. It reads props, so it can only say a child is *declared*
   hidden.
2. One assertion in the browser suite walking `Accessibility.getFullAXTree`
   over the screens the suite already visits, requiring every node with an
   accessible name to have no named descendant. This is the half that says the
   property is *true*, not merely declared. It covers only visited screens,
   which is why it does not replace the scan.

## The scanner

Extends the tag parsing already in `tests/helpers/sourceScan.ts` rather than
adding a second parser. It needs one thing that helper lacks — a tokeniser
yielding every JSX tag with its name, self-closing flag and offsets — so
subtree walks become possible. That belongs in `sourceScan.ts`, beside
`enclosingTag`, which is the same problem solved one level down.

A candidate is an interactive tag (`Pressable`, `Touchable*`) that carries
`accessibilityLabel` and is not self-closing. Walking its subtree with a depth
counter, tracking which depths were entered under a hidden node, any `Text` or
vector-icon tag reached with no hidden ancestor is an offence.

Two things the walk must get right, both of which a naive version gets wrong:

- **A nested control ends the walk for that branch.** `ExchangeAnnouncement`
  wraps a whole announcement panel — including its own close button — in a
  labelled `role="alert"` Pressable. Hiding that subtree would erase the panel
  and the button with it. A labelled control containing another control is a
  different defect and is not this one's to fix.
- **Hidden must mean hidden by any of the three spellings** — `a11yHidden()`
  spread, `accessibilityElementsHidden`, `aria-hidden` — and inherited by
  descendants, since hiding a wrapper is the cheapest fix where a control has
  several children.

The scan must not be able to pass vacuously: a test asserts it finds a known
candidate in a fixture, so a scanner that silently stops matching is red rather
than green.

## The fix

`components/MenuButton.tsx` first and separately. It is the repo's reference
control and every menu screen's buttons are instances of it, so one prop there
fixes many rendered controls that the source scan counts as one. Its `icon`
prop arrives already built from the caller, so the hide goes on a wrapper
rather than on the icon.

The rest are hidden at the child, or at the one container that already wraps
several children. Where a control's label does not in fact carry what its
children say, the label is wrong and gets fixed — that is a real defect, not an
exception.

## Risk, and what pays for it

`aria-hidden` does not affect Playwright's `getByText`, so the browser suite is
unaffected — established in #393. The native suite is the exposure: RNTL
excludes hidden elements from queries by default, so any test locating one of
these controls by its visible text stops finding it. There are 59 text queries
across the native suite. Each break is a real signal about a control this
change touched, and the fix is to query by label, which is what the control is
actually called.

## Definition of done

- A labelled control with an unruled child fails the suite, naming itself
- The scan cannot pass vacuously — a fixture proves it finds candidates
- Every one of the 55 is fixed or listed with a reason, and the list is short
- The browser confirms the property on the screens the suite visits
- `npm run agent:check`, the native suite and the browser suite all pass
