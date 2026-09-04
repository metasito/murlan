---
name: RN/RN-Web flexWrap + gap + percentage flexBasis instability
description: Why a wrapping flex grid intermittently collapses to one item per line, and the fix pattern used.
---

A `flexWrap: "wrap"` row combining a percentage `flexBasis` (e.g. `"45%"`) with a
`gap` on the container was observed, in this app's Expo/RN 0.81 (New
Architecture) home screen, intermittently collapsing every child to its own
full-width line after the app had been running for a while — turning an
intended 2-then-1 tile grid into a stack of full-width pills. The trigger
wasn't pinned down (suspects: Yoga's wrap line-breaking cache going stale
across re-layouts, or RN-Web's `gap` polyfill rounding), and it did not
reproduce on demand in a fresh load — only after time in session.

**Why:** flexWrap's line-breaking decision is heuristic and, at least on this
RN/Yoga version, not reliably stable across many re-layouts when combined with
percentage `flexBasis` and `gap`. Chasing the exact root cause was not
tractable without sustained device access.

**How to apply:** For a fixed-size wrapping grid (row-of-2 tiles, etc.),
prefer building the rows explicitly in JS (chunk the items, render one `View`
per row with `flexDirection: "row"` and `flex: 1` children) instead of relying
on `flexWrap` to decide line breaks. This removes the dependency on the wrap
algorithm entirely and is immune to the bug regardless of its root cause.
