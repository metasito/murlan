# Three roles, three nodes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the alert, the dismiss affordance and the close button into
three nodes in both components, and delete #492's two exceptions rather than
amend them.

**Architecture:** The alert becomes a node that is never a control; the
press-anywhere wrapper keeps `onPress` and stops being an accessibility
element; the close button that already exists in both files becomes reachable
for the first time.

**Tech Stack:** React Native / react-native-web, node:test, Jest +
`@testing-library/react-native`, Playwright via CDP `Accessibility.getFullAXTree`.

**Spec:** `docs/superpowers/specs/2026-08-28-alert-button-container-design.md`

## Global Constraints

- **Default is no comment.** Only an invisible constraint, a *why* the obvious
  approach is wrong, a contract the types cannot carry, or a pointer to the
  authority. Never explain the defect being fixed.
- **Every user-facing string goes through `t()`**, keyed in all three locales.
- **Hiding is `{...a11yHidden()}`** from `lib/a11y.tsx`; the live region is
  `<A11yStatus>` from the same module.
- **Commit by pathspec.**
- `accessible` reaches the DOM as nothing; it is an iOS-only lever. Do not
  reach for it expecting a web effect.

---

### Task 1: The red run

**Files:**
- Modify: `tests/a11yOneNode.test.ts` (`DELIBERATELY_REACHABLE`)

- [ ] **Step 1: Delete both entries**, leaving the array empty.

- [ ] **Step 2: Run the sweep and read the failure**

Run: `node --test tests/a11yOneNode.test.ts`
Expected: FAIL, naming both controls with their reachable children. Keep that
output — it is what Tasks 2 and 3 tick down. `every exception still names a
control that has one` should pass vacuously on an empty list, which is correct.

- [ ] **Step 3: Commit the empty list alone**, red on purpose.

```bash
git add -- tests/a11yOneNode.test.ts
git commit -m "Stop excusing the two nodes that are three things at once"
```

---

### Task 2: `ExchangeAnnouncement` — the panel is the alert

**Files:**
- Modify: `components/ExchangeAnnouncement.tsx:194-201`
- Test: `tests/native/exchangeAnnounceBothWays.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('offers the close button as a control of its own', async () => {
  const view = await render(<ExchangeAnnouncement {...props} />);
  expect(view.getByLabelText(en['exchangeAnnouncement.closeA11yLabel'])).toBeTruthy();
});

it('announces without being a control', async () => {
  const view = await render(<ExchangeAnnouncement {...props} />);
  expect(view.queryAllByRole('button', { name: /scambio/i })).toHaveLength(0);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx jest --selectProjects ios -t "control of its own"`

- [ ] **Step 3: Implement**

The outer `Pressable` keeps `onPress` and loses its accessibility identity; the
alert moves to the container it wraps:

```tsx
<Pressable
  onPress={handleDismiss}
  style={styles.card}
  // Pointer only. The close button below is the affordance a reader uses, and
  // leaving this an accessibility element makes the panel a UIKit leaf, which
  // is what put the close button out of reach on iOS.
  accessible={false}
  accessibilityRole="alert"
  accessibilityLiveRegion="polite"
>
```

Drop `accessibilityLabel` and `accessibilityViewIsModal`, and drop
`dismissHint` with them — the hint described a press target that is no longer
announced. Remove the now-unused `useA11yHint` import and the
`exchangeAnnouncement.dismissA11yHint` key from all three locales if nothing
else uses it.

- [ ] **Step 4: Run the native suite**

Run: `npx jest --selectProjects ios`

- [ ] **Step 5: Commit**

---

### Task 3: `NotificationBanner` — the announcement gets its own node

**Files:**
- Modify: `components/NotificationBanner.tsx:150-171`
- Test: `tests/native/bannerBand.test.tsx` or a new
  `tests/native/bannerOneNode.test.tsx`

**Interfaces:**
- Consumes: `A11yStatus` from `@/lib/a11y`.

- [ ] **Step 1: Write the failing test**

```tsx
it('announces through a live region, not through the button it sits in', async () => {
  const view = await render(<NotificationBanner notification={INVITE} onDismiss={() => {}} />);
  expect(view.getAllByText(`${INVITE.title}. ${INVITE.message}`).length).toBeGreaterThan(0);
  expect(view.queryAllByText(INVITE.title, { includeHiddenElements: false })).toHaveLength(0);
});

it('offers the close button as a control of its own', async () => {
  const view = await render(<NotificationBanner notification={INVITE} onDismiss={() => {}} />);
  expect(view.getByLabelText(en['notificationBanner.closeA11yLabel'])).toBeTruthy();
});
```

- [ ] **Step 2: Run it and see it fail**

- [ ] **Step 3: Implement**

The body stays a named button because pressing it runs the notification's own
action; its face is hidden like every other control's. The announcement moves
beside it:

```tsx
<View style={[styles.banner, …]}>
  <A11yStatus label={a11yLabel ?? ""} veiled={!notification} />
  <Pressable … accessibilityRole="button" accessibilityLabel={a11yLabel}>
    <View style={[styles.iconCircle, …]} {...a11yHidden()}>…</View>
    <View style={styles.textGroup} {...a11yHidden()}>…</View>
  </Pressable>
  <Pressable … close … />
</View>
```

Drop `accessibilityRole="alert"` and `accessibilityLiveRegion` from the body —
`A11yStatus` carries both now.

- [ ] **Step 4: Run the native suite and the sweep**

Run: `npx jest --selectProjects ios && node --test tests/a11yOneNode.test.ts`
Expected: both green; the sweep is now green with an empty exception list.

- [ ] **Step 5: Commit**

---

### Task 4: The browser confirms both

**Files:**
- Modify: `tests/e2e/oneAccessibleNode.spec.ts`

- [ ] **Step 1: Add the assertions**

The source scan cannot say whether the close button is *reachable* or whether
the alert is a control. Extend the existing AX-tree walk: on the screen where
the announcement renders, require a `button` node carrying the close label, and
require the `alert` node to have no accessible name of its own.

- [ ] **Step 2: Run it**

Run: `npm run test:e2e -- oneAccessibleNode.spec.ts`

- [ ] **Step 3: Prove it can fail** — restore `accessibilityLabel` on the panel,
  rerun, confirm the alert-is-not-a-control assertion names it. Restore.

- [ ] **Step 4: Commit**

---

### Task 5: Say what is now true

**Files:**
- Modify: `tests/a11yOneNode.test.ts` (the `DELIBERATELY_REACHABLE` comment),
  `CLAUDE.md` if its wording still claims two exceptions

- [ ] **Step 1:** The list is empty and the comment should say that empty is the
  state, not the goal.
- [ ] **Step 2:** `npm run typecheck && npm run agent:check && npx jest --selectProjects ios`
- [ ] **Step 3:** Commit.

## Self-review

- **Spec coverage.** Alert as its own node → Tasks 2 and 3. Dismiss affordance
  de-announced → Task 2. Close button reachable → Tasks 2, 3, 4. Exceptions
  removed → Task 1, verified in Task 3 step 4. Browser half → Task 4.
- **Risk.** The announcement failing silently is the one thing no check speaks;
  Task 4 pins the DOM shape instead, which is the closest an automated check
  gets.
- **Naming.** `a11yLabel` is the existing local in both files and is used under
  that name throughout.
