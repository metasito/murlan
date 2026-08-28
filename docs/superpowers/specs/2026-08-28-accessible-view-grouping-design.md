# A labelled `<View accessible>` — design

Issue #500. Nineteen sites declare `accessible` on a plain `View`, most with a
label and live children. #492 fixed the same shape for touchables; this is the
same premise one tag-name over, but the fix is **not** the same, and measuring
why is most of this document.

## What is actually broken

`accessible` is what makes a view an accessibility element. On iOS it becomes
`isAccessibilityElement` (`RCTViewComponentView.mm:348`) and the view is a UIKit
**leaf**: its children are never enumerated. react-native-web forwards the prop
nowhere — `modules/forwardedProps/index.js` has no `accessible` key — so on the
DOM the site renders as:

```html
<div aria-label="Rank 1, Ana, 1200"><span>1</span><span>Ana</span><span>1200</span></div>
```

A `div` with no role has the implicit role `generic`, and ARIA 1.2 **prohibits a
name on `generic`**. Measured against Chromium's own tree (`Accessibility.getFullAXTree`
over that exact markup): the node comes back `generic` with the name computed but
the role naming-prohibited, and all three children come back as named
`StaticText`. `lib/a11y.tsx`'s `A11yStatus` already records this in prose — it
exists because "a bare `aria-label` on a role-less `<div>`" names nothing.

So the platforms are broken in opposite directions:

| | iOS | web |
|---|---|---|
| the wrapper's label | spoken, and it is the only thing spoken | not spoken |
| the children | never reached | the only thing spoken |

#492's remedy — hide the children — is therefore **wrong here**. It would fix
iOS (already fine) and leave the web silent, which is worse than the defect.

Four of the nineteen already hide their children (`components/Slider.tsx`,
`components/HandBreakdown.tsx` ×2, `components/table/rotateOverlay.tsx`,
`components/GameTable.tsx`'s top bar). Every one of those except the Slider is
**silent on web today**. The Slider escapes because `a11yState({ role: "adjustable" })`
gives it `role="slider"`, and a slider may be named.

That is the whole finding: what makes a label reach a web reader is a **role**,
not `accessible`.

## The fix

One helper in `lib/a11y.tsx`, beside the others that already emit a web twin:

```tsx
/**
 * A container that speaks as one node: labelled, with its own contents hidden.
 *
 * `accessible` is what makes a View an accessibility element on iOS, and
 * react-native-web forwards it nowhere — the label would land on a role-less
 * `<div>`, whose role is `generic` and for which a name is prohibited. The web
 * half is the role, which is why this is not two props at the call site.
 */
export function a11yGroup(label: string): AccessibilityProps {
  const props: AccessibilityProps = { accessible: true, accessibilityLabel: label };
  if (isWeb) (props as Record<string, unknown>).role = "group";
  return props;
}
```

`group` survives react-native-web untouched: `propsToAriaRole` maps only the
roles it knows and returns anything else verbatim, and `role` is a forwarded
prop. It is deliberately *not* `accessibilityRole`, because React Native's
`AccessibilityRole` union has no `group` — the nearest, `summary`, maps to web
`region`, and a landmark per table row would bury the real landmarks.

With the role in place, hiding the children is correct again on both platforms,
so a grouped container reads exactly like a `#492` control: one node, its own
face hidden.

## The three outcomes, assigned

Every one of the nineteen resolves without an exception list. #495 removed
`DELIBERATELY_REACHABLE` and nothing here brings it back.

**1 — `a11yGroup`, children hidden (15 sites).** Rows, tiles and state blocks
whose label is a summary of text they draw themselves:
`app/(online)/leaderboard.tsx` ×3, `app/(online)/profile.tsx` ×9,
`components/HandBreakdown.tsx` ×2, `components/table/rotateOverlay.tsx`,
`components/GameTable.tsx`'s top bar. The last four already hide their children
and only need the role; the rest need both.

**2 — not an accessibility element at all (2 sites).**

- `app/(online)/friends.tsx:300` — a labelled `accessible` row that **contains a
  `Pressable`** (remove this friend). On iOS the row is a leaf, so that button
  cannot be reached at all. The grouping goes; the avatar and status dot take
  `a11yHidden()`; the two `Text` children read in order and the button is a
  control again.
- `app/auth.tsx:170` — `accessible` with `accessibilityLiveRegion="polite"` and
  no label. `accessible` is the wrong half: a live region announces the text
  that changes *inside* it, and there is no label for the leaf to speak. The
  prop goes and the region keeps its child `Text`.

**3 — already correct (2 sites).** `components/Slider.tsx` (a real control with
`role="adjustable"`) and `app/(online)/profile.tsx:330`'s form strip, whose
children are undecorated `View` pips with no text to leak.

## The checks

### The rule that already exists, with a false premise

`tests/a11yLabels.test.ts` was written for exactly this — its header says "an
`accessibilityLabel` on a layout container is in the DOM and in no accessibility
tree", and it names the `generic` role and the prohibited name. It lets all
nineteen through because its `REACHABLE` regex counts `\baccessible\b` as making
the label reachable:

```ts
const REACHABLE = /\baccessible\b|accessibilityRole|a11yState\(/;
```

That term is the defect. `accessible` reaches the DOM as nothing, so it is the
one thing in that alternation that does *not* make a label reachable. Removing
it and adding `a11yGroup\(` is the root-cause fix, and it turns the existing
sweep red on the fifteen sites of outcome 1 without a new scanner.

### The rules that are new

`tests/a11yOneNode.test.ts` gains the shape rather than a second scanner. Its
`reachableChildren` already walks subtrees, tracks hidden ancestors and resolves
`Text` aliases; what changes is which tags it considers.

- **Candidates widen.** A tag is a candidate if it is interactive (today's rule)
  **or** carries a bare `accessible` prop. The existing assertion then applies
  unchanged: a labelled candidate must leave no face child reachable.
- **A new rule, `accessible` never seals a control.** A candidate carrying
  `accessible` must hold no interactive descendant. This is the `friends.tsx`
  defect, and it is not about a control's own face — it is a control that
  cannot be reached at all on one platform. It gets its own assertion and its
  own message.
A third rule — "`accessible` on a non-touchable must be written as `a11yGroup()`"
— is deliberately **not** added. The corrected `REACHABLE` above already refuses
the hand-written pair, by the property that actually matters rather than by
spelling, and two rules refusing the same code differ only in which error a
reader sees first.

Each rule gets a fixture test in the same file, in the style already there:
a synthetic source string proving the rule fires. The sweep cannot pass
vacuously because the fixtures exercise the walker directly, and the sweep
itself runs over a non-empty `app/` + `components/`.

The browser half, `tests/e2e/oneAccessibleNode.spec.ts`, needs no change to
*find* these — `WIDGETS` holds no role for a container, so it never looked at
them — but it gains one assertion of its own: on the screens it already walks,
no node has an `aria-label` and the role `generic`. That is the measured defect
stated as a check, and it is the only place the claim is true or false.

## Risk

`role="group"` is one more role in the tree on web. A group with a name is
announced as such when a reader enters it, which is the intent for a table row
and would be noise on a decorative wrapper — so `a11yGroup` is for containers
whose label is a summary someone should hear, and the scan does not push anyone
towards it: a container with nothing to say should carry no label and no
`accessible`.

The change touches nine files across `app/` and `components/` plus two test
files, and every edit is one of the three outcomes above. Nothing here changes
what is drawn.
