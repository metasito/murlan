# Reordering a hand by hand — research pass, August 2026

Research-only document for #531. Nothing here is implemented. Sources were fetched from their
primary hosts on **2026-08-30**; where a design-system page would not serve its body to a
fetch (Apple's HIG and Material 3 are both client-rendered), that is said so plainly and the
claim is attributed to the search summary rather than presented as a quotation. Library
defaults and codebase facts were read out of `node_modules/` and `components/` directly rather
than recalled.

The ticket's own default — long press, then move — is treated here as a hypothesis to test,
which is what its comment asked for.

---

## Bottom line

- **The gesture default survives the research: long press, then move.** Not because it is
  familiar, but because it is the only gesture on this screen that cannot be confused with the
  two that already exist. A press selects, and a hand is played by selecting and confirming.
  Every distance-threshold alternative makes a mis-swipe a reorder and a slow tap a maybe.
- **There is a hard accessibility constraint the ticket does not mention, and it is Level AA.**
  [WCAG 2.5.7 Dragging Movements](#s-wcag) requires that anything operated by dragging is
  also achievable by a single pointer *without* dragging, unless dragging is essential.
  Reordering a hand is a convenience, not essential — the game is fully playable without it —
  so a drag-only implementation fails AA.
- **That constraint does not cost a visible control, so it does not collide with "no sort
  button".** This codebase already answers exactly this problem twice: `components/Slider.tsx`
  and `components/ReplayControls.tsx` expose `accessibilityActions` of `increment` /
  `decrement` for a value that is otherwise dragged. The same shape — "move left", "move
  right" as accessibility actions on a card — satisfies 2.5.7 with **nothing added to the
  screen**. See [§4](#4-the-non-drag-path).
- **The motion vocabulary for this feature is already in the design system, unused.**
  `Motion.spring.pickup` is documented in `lib/tokens.ts` as "Direct manipulation: the object
  must arrive under the finger with no visible wobble", critically damped at
  `{ damping: 37, stiffness: 340 }`; `Motion.spring.land` is "Something dropped onto a
  surface: fast approach, one small bounce". Whoever wrote those was describing this
  interaction. The build should spend them rather than invent a third.
- **"Held" has to differ from "selected" on a channel selection does not already use.**
  Selection is *already* a lift: `SELECT_LIFT = -16` in `components/table/hand.tsx`, `-14` in
  `CardView.tsx`, plus a rotation and a `cardSelected` border. Lifting further is therefore
  the one thing a held card must not rely on. See [§3](#3-held-is-not-selected).

---

## 1. Why a hand gets reordered at all

The player's own words on #531 are *"as per their desire"*, which is a preference rather than
a mechanic. The academic survey of digital card games gives the functional reason underneath
it: players order the cards in their hand for **faster recognition** of what they hold
([Steinböck 2017](#s-steinbock)). That matters for what the feature has to be good at — it is
not a toy, it is a way of making a hand readable at a glance, and a reorder that is slow or
uncertain defeats its own purpose.

It also settles a scope question without needing the owner: this is about *reading* the hand,
so it must work when it is not your turn. That is when you are reading it.

## 2. The gesture

### What the platforms do

Apple's Human Interface Guidelines describe touch-and-hold as the initiator: content
"appear[s] to rise and adhere to the user's finger", and a drag image is shown once the finger
has moved about three points, "translucent" so destinations stay visible underneath
([Apple HIG](#s-hig) — **[SUMMARY]**, see the note on that source). Material 3's gesture page
would not serve its body to a fetch and is not cited here.

### What the library gives us for free

`react-native-gesture-handler` is already a dependency at `~2.28.0` and
`GestureHandlerRootView` is already mounted in `app/_layout.tsx`, so nothing has to be wired
up. Its long-press defaults, read from `node_modules/react-native-gesture-handler/src`:

| Setting | Default | Where |
| --- | --- | --- |
| `minDurationMs` | **500** | `handlers/LongPressGestureHandler.ts` doc comment; `web/handlers/LongPressGestureHandler.ts` `DEFAULT_MIN_DURATION_MS` |
| `maxDist` | a squared default the handler resets to | same file, `defaultMaxDistSq` |

### The recommendation, and the argument for it

**Long press at the platform default of 500ms, then move.** The reason is not tradition. This
screen already spends both cheaper gestures:

- a **press** selects a card, and
- a **press on the confirm** plays what is selected.

So a reorder cannot begin on a touch, and it cannot begin on a short drag either: the hand is
a horizontal fan of overlapping cards, and a horizontal finger movement across it is exactly
what a player does when they are *not* trying to reorder anything. A distance threshold would
turn every such movement into a maybe-reorder, and the cost of a false positive here is high —
the player's carefully arranged hand is the thing being disturbed.

Long press is the only gesture left that is unambiguous, and 500ms is the number the player's
thumb has already learned from every other app on the device. **Shortening it is the tempting
mistake**: at 250–300ms it starts to catch the slow taps of someone thinking about which card
to play, which is precisely the moment a hand is being read rather than reordered.

### What must be true for it to feel right

- The lift must begin **at the threshold, not at the release** — the hold is only legible if
  the card answers it while the finger is still down. This is what `Motion.spring.pickup`
  exists for.
- Haptic feedback at the threshold. The codebase already has `hapticMedium` / `hapticError`.
- **A press that becomes a long press must not also select.** Selection and the drag are
  driven by the same finger-down, so the selection has to be withheld until the gesture has
  resolved, or applied and then reverted — and reverting is visible. Withholding is correct.

## 3. "Held" is not "selected"

The ticket asks what tells a player a card is held rather than selected. In this codebase the
answer is constrained by what selection has already taken:

| Channel | Selected today | Available to "held" |
| --- | --- | --- |
| Vertical lift | **taken** — `SELECT_LIFT = -16`, `CardView` `-14` | no |
| Rotation | **taken** — the tilt that stops the lift reading as a flat slide | no |
| Border | **taken** — `styles.cardSelected` | no |
| Scale | free | **yes** |
| Shadow / elevation | free | **yes** |
| Leaving the arc | free | **yes — and this is the strong one** |

The decisive one is the last. Every card in the hand, selected or not, sits **on the arc**
`handLayout` computes. A held card is the only thing that leaves it: it follows the finger in
free two dimensions, at a slight scale-up with a shadow under it. Nothing else on the table
does that, so no legend is needed to read it. Apple's translucency recommendation is for
dragging content *over a destination you need to see*; here the destination is the gap in the
player's own fan, so opacity is better spent staying opaque and legible.

## 4. The non-drag path

[WCAG 2.5.7](#s-wcag), Level AA, verbatim:

> All functionality that uses a dragging movement for operation can be achieved by a single
> pointer without dragging, unless dragging is essential or the functionality is determined by
> the user agent and not modified by the author.

"Essential" means removing it would fundamentally change the information or functionality.
Reordering a hand does not meet that bar — the game is complete without it — so the exception
does not apply and the alternative is required.

The understanding document's own example for this case is *"tap an element, then use adjacent
controls to move it up or down"*. Taken literally that is a visible control, which #531
forbids. It does not have to be visible: this codebase already solves the identical problem in
two places without one.

```
components/Slider.tsx:153        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
components/ReplayControls.tsx:97 accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
```

Both are values a sighted player drags, exposed to assistive technology as two discrete
actions and to nobody else. A card carrying `moveLeft` / `moveRight` actions is the same
pattern, costs no pixels, and is the established idiom of the repo it lands in. **The owner's
"no sort button" and Level AA are not in conflict** — the finding is that they were never
going to be.

## 5. The gap, and the fan behind it

Two idioms exist for showing where a dragged item will land
([Pencil & Paper](#s-pencilpaper)): a **ghost placeholder** that holds a slot without moving
its neighbours, and the **maximal** form where the other items physically shift to open a gap.
That article presents the trade-off and declines to pick, so the choice has to be made here.

**For a fan, the gap is the right one, and the reason is specific rather than aesthetic.** A
ghost placeholder assumes items occupy fixed slots; the hand does not. `handLayout` computes
each card's position, rotation and overlap *from its index and the hand's size*, so the cards
are already a function of the order. Opening a gap is not an effect to be added — it is what
the existing layout does when the index it is given changes. A ghost placeholder would need
new geometry that the arc does not otherwise have.

This also answers the third question: **the fan closes behind the card that left it**, for the
same reason and at the same moment, because with one card lifted out the remaining cards are
laid out as a hand of *n−1*.

Two consequences worth stating before anyone builds it:

- **The drop index is a function of the finger's position along the arc**, not of which card
  the finger is over — cards overlap, so "over" is ambiguous by construction.
- **Reordering while the gap is open must be continuous**, not settled on release. The gap
  moving as the finger moves is what makes the drop predictable; a gap that only appears at
  the end is a guess with an animation.

## 6. Reduced motion

The ticket already decides this — *"removes the animation, never the ability"* — and the
design system already carries the mechanism: `motionMs()` reads `Motion.reduced`, and the
springs are for "when the player caused it and is still touching it". Under reduced motion the
card should still leave the arc and still follow the finger — that is the *functionality*, and
it is direct manipulation rather than animation — while the gap opening and the fan closing
become instant rather than sprung.

## 7. What this leaves for the mockups

Settled by this pass, and not to be re-opened at the keyboard: the gesture and its threshold
(§2), what distinguishes held from selected (§3), the accessibility path (§4), and the gap
rather than a ghost (§5).

Left open, and genuinely a matter of taste for the owner to choose from:

1. **How far the held card leaves the arc** — a small lift that reads as "picked up off the
   fan", or a larger one that reads as "in the air".
2. **Whether the gap opens to a full card's width or to the fan's own overlap step.** The
   first is unmissable, the second keeps the hand's width constant while dragging.
3. **What the card does at the moment of release** — settle into the gap, or land with the
   single small bounce `Motion.spring.land` was written for.

---

## Sources

<a id="s-wcag"></a>
**[WCAG] Understanding Success Criterion 2.5.7: Dragging Movements**, W3C Web Accessibility
Initiative. https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html — fetched
2026-08-30. Normative SC text quoted verbatim in §4; Level AA; the "essential" definition and
the sortable-list example are from the same page.

<a id="s-hig"></a>
**[Apple HIG] Drag and drop — Patterns**, Apple Human Interface Guidelines.
https://developer.apple.com/design/human-interface-guidelines/drag-and-drop — **[SUMMARY]**.
The page is client-rendered and returned only its title to a fetch on 2026-08-30. The lift,
the ~3-point movement threshold and the translucency recommendation in §2 come from a search
engine's summary of it, not from the page body, and are marked as such rather than quoted.

<a id="s-pencilpaper"></a>
**[Pencil & Paper] Drag & Drop UX Design Best Practices**.
https://www.pencilandpaper.io/articles/ux-pattern-drag-and-drop — fetched 2026-08-30. Source
for the two destination idioms in §5. Carries no numeric specifications of any kind, which is
why every number in this document comes from the library, the token file or WCAG instead.

<a id="s-steinbock"></a>
**[Steinböck 2017] Game design patterns in digital card games**, TU Wien.
https://repositum.tuwien.at/bitstream/20.500.12708/2993/2/Steinboeck%20Matthias%20-%202017%20-%20Game%20design%20patterns%20in%20digital%20card%20games%20a...pdf —
**[SUMMARY]**. Cited in §1 for the claim that players order their hand for faster
recognition, from the search summary of the PDF rather than a full read.

### Primary facts read from this repository

Not sources in the citable sense, but the claims they support are the load-bearing ones:

- `node_modules/react-native-gesture-handler/src/handlers/LongPressGestureHandler.ts` and
  `.../web/handlers/LongPressGestureHandler.ts` — the 500ms default.
- `lib/tokens.ts` — `Motion.spring.pickup`, `Motion.spring.land`, `Motion.reduced`, `motionMs`.
- `components/table/hand.tsx` (`SELECT_LIFT`), `components/CardView.tsx` (the `-14` selection
  lift and the rotation) — what selection has already spent.
- `components/Slider.tsx`, `components/ReplayControls.tsx` — the `accessibilityActions`
  precedent.
- `app/_layout.tsx` — `GestureHandlerRootView` already mounted.

### Explicitly unverified

- Apple's exact wording, its three-point threshold and its translucency guidance (§2). The
  claim direction is corroborated by the platform's observable behaviour, but the page body
  was not read.
- The Steinböck claim in §1.
- **No comparable shipped card game was measured.** This pass reasons from platform guidance,
  the accessibility standard and this codebase's own constraints. A capture of how a specific
  shipped card game handles the gesture would strengthen §2 and §5 and was not obtained.
