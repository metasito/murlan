# A labelled `<View accessible>` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A labelled container speaks as one node on both platforms, and a container that would seal a control inside itself is refused.

**Architecture:** One helper, `a11yGroup(label)`, carries the platform split: `accessible` on native (which makes the view a UIKit leaf) and `role="group"` on web (which is what lets a label be announced at all). The rule that should already have caught these lives in `tests/a11yLabels.test.ts` and has a false premise — it counts `accessible` as making a label reachable, which on web it never does. Fixing that premise turns the existing sweep red on the real sites.

**Tech Stack:** Expo / React Native Web, node:test source scans, jest + `@testing-library/react-native` for the native project, Playwright + Chrome DevTools Protocol for the browser half.

**Spec:** `docs/superpowers/specs/2026-08-28-accessible-view-grouping-design.md`

## Global Constraints

- Every user-facing string goes through `t()` and exists in all three locales. This change adds no copy.
- No bare literals for colour, radius, font size, spacing or timing — all from `lib/theme.ts`.
- Default is no comment. Four things earn one: an invisible constraint, a *why* where the obvious approach is wrong, a contract the types cannot carry, a pointer to the authority. Never explain the defect being fixed — that belongs in the commit message.
- Commit by pathspec (`git add -- <files>`), never `git add -A`.
- `npm run agent:check` must print `agent:check PASS`; `npx jest` must be green because components change.

---

### Task 1: `a11yGroup`

**Files:**
- Modify: `lib/a11y.tsx`
- Test: `tests/native/a11yGroup.test.tsx` (create)

**Interfaces:**
- Produces: `a11yGroup(label: string): AccessibilityProps` — `{ accessible: true, accessibilityLabel: label }` on every platform, plus `role: "group"` on web. Every later task imports it from `@/lib/a11y`.

A new test file rather than a case in `tests/a11yProps.test.ts`: another agent is editing that file for #502, and a new file cannot conflict.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/native/a11yGroup.test.tsx — a container that speaks as one node needs a
// different half on each platform, and only one of the two is `accessible`.
import { describe, it, expect } from '@jest/globals';
import { a11yGroup } from '@/lib/a11y';

describe('a11yGroup', () => {
  it('makes the view an accessibility element and names it', () => {
    expect(a11yGroup('Rank 1, Ana, 1200')).toMatchObject({
      accessible: true,
      accessibilityLabel: 'Rank 1, Ana, 1200',
    });
  });

  // The jest `ios` project runs with Platform.OS === 'ios', where the DOM role
  // would be meaningless. The web half is asserted by the source scan in
  // tests/a11yLabels.test.ts and by the browser sweep, which are the only two
  // places it is true or false.
  it('carries no DOM role on native', () => {
    expect(a11yGroup('Rank 1, Ana, 1200')).not.toHaveProperty('role');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx jest --selectProjects ios tests/native/a11yGroup.test.tsx`
Expected: FAIL — `a11yGroup is not a function`.

- [ ] **Step 3: Add the helper**

In `lib/a11y.tsx`, immediately after `a11yDialog`:

```tsx
/**
 * A container that speaks as one node: labelled, with its own contents hidden.
 *
 * `accessible` is what makes a View an accessibility element on iOS, and
 * react-native-web forwards it nowhere — the label would land on a role-less
 * `<div>`, whose role is `generic` and for which a name is prohibited. The web
 * half is the role, which is why this is not two props at the call site. Not
 * `accessibilityRole`: React Native's role union has no `group`, and its
 * nearest, `summary`, reaches the DOM as the landmark `region`.
 */
export function a11yGroup(label: string): AccessibilityProps {
  const props: AccessibilityProps = { accessible: true, accessibilityLabel: label };
  if (isWeb) (props as Record<string, unknown>).role = "group";
  return props;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx jest --selectProjects ios tests/native/a11yGroup.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add -- lib/a11y.tsx tests/native/a11yGroup.test.tsx
git commit -m "Give a container one node on each platform"
```

---

### Task 2: The false premise, and the fifteen sites it was hiding

**Files:**
- Modify: `tests/a11yLabels.test.ts` (the `REACHABLE` regex)
- Modify: `app/(online)/leaderboard.tsx` (3 sites), `app/(online)/profile.tsx` (8 sites), `components/HandBreakdown.tsx` (2), `components/table/rotateOverlay.tsx` (1), `components/GameTable.tsx` (1)

**Interfaces:**
- Consumes: `a11yGroup` from Task 1; `a11yHidden` already exported from `@/lib/a11y`.

- [ ] **Step 1: Correct the premise**

In `tests/a11yLabels.test.ts`, replace:

```ts
const REACHABLE = /\baccessible\b|accessibilityRole|a11yState\(/;
```

with:

```ts
// `accessible` is deliberately absent: it makes a view an accessibility element
// on iOS and reaches the DOM as nothing, so on web it leaves the label on a
// role-less <div>. A role is what lets a name be announced, and `a11yGroup`
// is where a container gets one.
const REACHABLE = /a11yGroup\(|accessibilityRole|a11yState\(/;
```

- [ ] **Step 2: Run it and read the red**

Run: `node --test tests/a11yLabels.test.ts`
Expected: FAIL, listing fifteen `file:line: <View> label` entries across `app/(online)/leaderboard.tsx`, `app/(online)/profile.tsx`, `components/HandBreakdown.tsx`, `components/table/rotateOverlay.tsx` and `components/GameTable.tsx`. Keep that list; it is the work.

- [ ] **Step 3: Convert every listed site**

At each site, replace the hand-written pair

```tsx
<View style={styles.row} accessible accessibilityLabel={rowLabel}>
```

with

```tsx
<View style={styles.row} {...a11yGroup(rowLabel)}>
```

adding `a11yGroup` to that file's existing `@/lib/a11y` import (or a new import where the file has none). Where the label is written inline over several lines, keep it inline inside the call:

```tsx
<View style={styles.selfBlock} {...a11yGroup(`${t("ladder.ratingLabel")}: ${me.rating}. ${t("ladder.seasonLabel", { season: formatSeason(me.season, t) })}`)}>
```

- [ ] **Step 4: Hide each converted container's own face**

`components/HandBreakdown.tsx`, `components/table/rotateOverlay.tsx` and `components/GameTable.tsx`'s top bar already do this and need nothing further. For the rest, put `{...a11yHidden()}` on each `Text`/`Ionicons` child the container's label already speaks, or on the one wrapper that holds several — the same rule `tests/a11yOneNode.test.ts` enforces for controls.

`app/(online)/profile.tsx:330`'s form strip is the exception: its children are undecorated `View` pips with no text, so there is nothing to hide.

- [ ] **Step 5: Run both scans and the type checker**

Run: `node --test tests/a11yLabels.test.ts tests/a11yOneNode.test.ts && npx tsc --noEmit`
Expected: PASS on both scans, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -- tests/a11yLabels.test.ts "app/(online)/leaderboard.tsx" "app/(online)/profile.tsx" components/HandBreakdown.tsx components/table/rotateOverlay.tsx components/GameTable.tsx
git commit -m "Let a grouped container name itself on the web too"
```

---

### Task 3: `accessible` must not seal a control

**Files:**
- Modify: `tests/a11yOneNode.test.ts`
- Modify: `app/(online)/friends.tsx:300`, `app/auth.tsx:170`

**Interfaces:**
- Consumes: `reachableChildren(source: string, aliases?: Set<string>): string[]` and `jsxTags` / `blankComments` from `tests/helpers/sourceScan.ts`, both already in the file.
- Produces: `sealedControls(source: string): string[]` — `line: <Tag> -> Pressable@line` for every `accessible` container holding an interactive descendant.

- [ ] **Step 1: Write the failing fixture tests**

Add to `tests/a11yOneNode.test.ts`, after the existing fixtures:

```ts
test("an accessible container reports the control it seals", () => {
  assert.deepEqual(
    sealedControls(
      '<View accessible accessibilityLabel={x}>\n  <Text>a</Text>\n  <Pressable onPress={f} />\n</View>'
    ),
    ["1: <View> -> Pressable@3"]
  );
});

// The floor. A container with no control inside is the ordinary case, and a
// rule that fired on it would be a rule nobody could satisfy.
test("a container with no control inside is clean", () => {
  assert.deepEqual(
    sealedControls('<View accessible accessibilityLabel={x}>\n  <Text>a</Text>\n</View>'),
    []
  );
});

test("no accessible container seals a control", () => {
  const offenders: string[] = [];
  for (const rel of scanned()) {
    for (const hit of sealedControls(read(rel))) offenders.push(`${rel}:${hit}`);
  }
  assert.deepEqual(
    offenders,
    [],
    "`accessible` makes the view a UIKit leaf, so a control inside it cannot be " +
      `reached on iOS at all — drop the grouping, or move the control out:\n  ${offenders.join("\n  ")}`
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/a11yOneNode.test.ts`
Expected: FAIL — `sealedControls is not defined`.

- [ ] **Step 3: Add the walker**

In `tests/a11yOneNode.test.ts`, beside `reachableChildren`:

```ts
/** A bare `accessible`, however it is written: the prop, or `a11yGroup()`. */
const GROUPING = /(?:^|\s)accessible(?=\s|$|=\{true\})|a11yGroup\(/;

/**
 * `line: <Tag> -> Pressable@line` for every grouped container holding a
 * control. On iOS the container is one leaf and the control inside it is
 * reachable by nobody, which no amount of hiding can fix.
 */
export function sealedControls(source: string): string[] {
  const src = blankComments(source);
  const lineAt = (i: number) => src.slice(0, i).split("\n").length;
  const tags = jsxTags(src);
  const out: string[] = [];

  for (let k = 0; k < tags.length; k++) {
    const container = tags[k];
    if (container.isClose || container.selfClose) continue;
    if (INTERACTIVE.test(container.name) || !GROUPING.test(container.text)) continue;

    let depth = 0;
    const sealed: string[] = [];
    for (let j = k + 1; j < tags.length; j++) {
      const child = tags[j];
      if (child.isClose) {
        if (depth === 0) break;
        depth -= 1;
        continue;
      }
      if (INTERACTIVE.test(child.name)) sealed.push(`${child.name}@${lineAt(child.start)}`);
      if (!child.selfClose) depth += 1;
    }
    if (sealed.length) {
      out.push(`${lineAt(container.start)}: <${container.name}> -> ${sealed.join(", ")}`);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it and read the red**

Run: `node --test tests/a11yOneNode.test.ts`
Expected: the two fixtures pass; the sweep fails naming `app/(online)/friends.tsx:300: <View> -> Pressable@…`.

- [ ] **Step 5: Free the friend row's control**

In `app/(online)/friends.tsx`, drop the grouping from the row and hide only what is decorative:

```tsx
<View key={item.id} style={styles.row}>
  <View style={styles.avatarWrapper} {...a11yHidden()}>
```

The two `Text` children then read in order and the remove-friend `Pressable` is a control again. Add `a11yHidden` to the file's `@/lib/a11y` import if it is not there.

- [ ] **Step 6: Take `accessible` off the auth error box**

In `app/auth.tsx:170`:

```tsx
<View style={styles.errorBox} accessibilityLiveRegion="polite">
```

A live region announces the text that changes inside it; `accessible` would make the box a leaf with no label of its own to speak, and there is no label here to give it.

- [ ] **Step 7: Run every scan**

Run: `node --test tests/a11yOneNode.test.ts tests/a11yLabels.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add -- tests/a11yOneNode.test.ts "app/(online)/friends.tsx" app/auth.tsx
git commit -m "Stop a grouped row sealing the control inside it"
```

---

### Task 4: The browser half

**Files:**
- Modify: `tests/e2e/oneAccessibleNode.spec.ts`

**Interfaces:**
- Consumes: the `AxNode` interface and the CDP session already set up in that file.

- [ ] **Step 1: Measure before asserting**

Run: `npm run test:e2e -- oneAccessibleNode.spec.ts`
Expected: the three existing screens pass. Then add a temporary `console.log` of every non-ignored node whose role is `generic` and whose `name.value` is non-empty, and run again, to see whether `/`, `/lobby` and `/rules` hold any such node beyond the ones this change fixes. If they hold others, they are the same defect and belong in Task 2's list; do not weaken the assertion to accommodate them.

- [ ] **Step 2: Add the assertion**

Inside the existing `for (const screen of SCREENS)` test, after the widget sweep:

```ts
    // A name on a `generic` node is a name ARIA prohibits: `accessible` reaches
    // the DOM as nothing, so a labelled container that never took a role lands
    // here and is announced by nobody.
    const unnameable = nodes
      .filter((n) => !n.ignored && n.role?.value === "generic" && n.name?.value?.trim())
      .map((n) => `generic "${n.name!.value}"`);
    expect(unnameable).toEqual([]);
```

- [ ] **Step 3: Run it**

Run: `npm run test:e2e -- oneAccessibleNode.spec.ts`
Expected: PASS on all three screens.

- [ ] **Step 4: Commit**

```bash
git add -- tests/e2e/oneAccessibleNode.spec.ts
git commit -m "Refuse a name the browser will not announce"
```

---

### Task 5: The invariant

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Extend the existing invariant**

The bullet beginning "**A labelled control exposes one accessible node**" gains a second half naming the container case:

> A labelled *container* is the same shape one tag-name over, with the opposite remedy: `accessible` makes it a leaf on iOS and reaches the DOM as nothing, so on web the label sits on a role-less `<div>` — role `generic`, for which a name is prohibited — and hiding the children would leave nothing to read at all. `a11yGroup()` carries both halves. Pinned by `tests/a11yLabels.test.ts` (the label reaches somebody), `tests/a11yOneNode.test.ts` (`sealedControls`, because a grouped container must not hold a control) and `tests/e2e/oneAccessibleNode.spec.ts` (no name on a `generic` node).

- [ ] **Step 2: Run the whole gate**

Run: `npm run agent:check && npx jest --silent`
Expected: `agent:check PASS`, jest green.

- [ ] **Step 3: Commit**

```bash
git add -- CLAUDE.md
git commit -m "State what a labelled container needs on each platform"
```

---

## Self-review

**Spec coverage.** The helper → Task 1. The corrected `REACHABLE` premise and the fifteen outcome-1 sites → Task 2. The two outcome-2 sites and the sealed-control rule → Task 3. The two already-correct sites need no task, which is the spec's own finding. The browser assertion → Task 4. The invariant → Task 5.

**Placeholders.** None: every step carries the code or the exact command and the expected output. Task 2 Step 3 states the transformation once and applies it to a list the test itself prints, rather than repeating fifteen near-identical hunks.

**Type consistency.** `a11yGroup(label: string): AccessibilityProps` is defined in Task 1 and used under that name and signature in Tasks 2 and 3. `sealedControls(source: string): string[]` is defined and used in Task 3 only. `INTERACTIVE`, `jsxTags` and `blankComments` are existing names in `tests/a11yOneNode.test.ts`, used unchanged.
