# Three roles, three nodes — the announcement panel and the notification banner

Design for #495.

## The defect

Two nodes each do three jobs at once:

| | `ExchangeAnnouncement.tsx:194` | `NotificationBanner.tsx:153` |
|---|---|---|
| alert | `accessibilityRole="alert"` | `accessibilityRole="alert"` + `accessibilityLiveRegion` |
| button | `onPress` dismisses | `onPress` dismisses **and** runs `notification.onPress` |
| container | holds its own close button | holds its own close button |

Both carry an `accessibilityLabel`, and `Pressable` defaults `accessible` to
true. The consequences differ by platform, and they are opposite:

- **iOS** — `accessible` becomes `isAccessibilityElement`
  (`RCTViewComponentView.mm:348`), which makes the view a UIKit leaf. The close
  button inside is not reachable at all.
- **Web** — react-native-web forwards no `accessible`, so the children stay
  fully live under a node that is already named: a named region with named
  descendants, which is what #492 refuses everywhere else. These two are its
  only exceptions.

There is a third consequence that only the banner has, and it is why #492 left
it alone rather than fixing it: **a live region announces the text that changes
inside it, not its own label.** Hiding the banner's copy would have left the
region with nothing to announce, and the banner never unmounts (CLAUDE.md), so
a content change is the only trigger there is. Every notification would have
arrived silently on web.

## What react-native-web actually emits

Checked rather than assumed, because the fix rests on it:

- `accessibilityRole` → `role` (`createDOMProps/index.js:604-610`), and `alert`
  is absent from `propsToAriaRole`'s remap table, so it passes through
  unchanged.
- `accessibilityLiveRegion` → `aria-live` (`forwardedProps/index.js:95`).
- `accessible` → nothing. It is absent from the allow-list entirely.

That last one is what makes the fix cheap: dropping `accessible` costs nothing
on web and is precisely what un-leafs the node on iOS.

## The shape

Three jobs, three nodes, in both files:

1. **The alert** is its own node, never a control. It carries the live-region
   semantics and nothing else.
2. **The dismiss affordance** stays for the pointer and stops being an
   accessibility element. It is a convenience duplicate of a close button that
   already exists in both files, so nothing is lost by taking it out of the
   reading order — and taking it out is what lets a reader into the panel.
3. **The close button** is untouched, and becomes genuinely reachable on both
   platforms for the first time.

The two files differ in one respect, because their content differs:

**`ExchangeAnnouncement`** — the panel's copy *is* the announcement (names,
cards, a sentence per direction). So the alert is the panel container itself:
a `View` with `accessibilityRole="alert"`, no `accessible`, no label, its text
readable. A reader hears the announcement on insert and can then walk the
detail. The press-anywhere-to-dismiss wrapper keeps `onPress` and gains
`accessible={false}`.

**`NotificationBanner`** — pressing the body performs the notification's own
action, so the body must stay a named button; and a named button's children are
its face, which #492 hides. That leaves the region with nothing to announce, so
the announcement gets its own node: `<A11yStatus label={a11yLabel} veiled={…}/>`,
which `lib/a11y.tsx` already defines as a polite live region for exactly this
case — a container that cannot be `accessible` without collapsing its controls.
The label on the body button stays what it is; one is the announcement, the
other is the control's name when you navigate onto it.

## What the checks look like

`tests/a11yOneNode.test.ts` is the primary check and it is already written: the
two `DELIBERATELY_REACHABLE` entries come out, and the sweep must stay green
with them gone. That is the whole point of the DoD's "removed, not amended".

Two things the source scan cannot see, which need the browser:

- **The close button is reachable.** On the AX tree it must appear as its own
  `button` node, not as text inside another node.
- **The alert exists and is not also a control.** A `role="alert"` node with no
  accessible name of its own, whose text is its content.

Both are readable from `Accessibility.getFullAXTree`, the same instrument #492
used, extended to the screens these render on. `ExchangeAnnouncement` is
reachable in the offline match flow the browser suite already drives.

The native side keeps `tests/native/exchangeAnnounceBothWays.test.tsx` green and
gains an assertion that the close button is a reachable control — on
react-test-renderer that means RNTL's default query finds it, which it cannot
today because nothing hides it and nothing needs to: the defect there is the
iOS leaf, which RNTL does not model. So the native suite can only pin the prop
shape; the browser pins the behaviour. Say so in the test rather than implying
more.

## Risks

- **Losing the announcement.** The failure mode is silent, and no automated
  check speaks. Mitigated by pinning the DOM shape (`role="alert"`,
  `aria-live`, non-empty text inside it) rather than the speech.
- **`accessible={false}` on the dismiss wrapper** removes it from the iOS
  reading order. That is intended, and the close button is the affordance that
  replaces it. Worth stating at the call site so it is not "fixed" back.

## Definition of done

Unchanged from the issue, plus: both `DELIBERATELY_REACHABLE` entries removed
and the sweep green without them; the browser confirms a reachable close button
and an alert node that is not a control.
