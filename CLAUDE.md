# Murlan

Traditional Albanian card game (Big Two family), as an Expo app served as web by an
Express + Socket.io server on Replit. **English (`locales/en.ts`) is the source of truth for
UI copy**; Italian and Albanian are translations of it. A *manche* is one hand; a *partita*
is the match they add up to. **Every key in English must exist in every locale, no
exception** — `it.ts` and `sq.ts` are `Record<keyof typeof en, string>`, so a gap is a
compile error.

**This file is only what you cannot get by reading the code.** Stack, file layout and game
rules are deliberately absent — `package.json`, `ls`, and `docs/RULES.md` are authoritative
and never go stale.

---

## Replit — breaking any of these takes production down

- Port from `process.env.PORT`, database from `process.env.DATABASE_URL`.
- `DATABASE_URL`, `SESSION_SECRET`, `PORT` must be set in Replit Secrets.
- No build step needing local tooling. Must launch from the Run button with no setup.
- **Production runs Node 22** (`.replit` `modules`), CI tests on 24. `server:build` carries
  `--target=node22` so nothing newer than the deploy runtime is emitted.
- **`server/schemaDdl.ts` is the only thing that creates tables**, at boot, from
  `shared/schema.ts`. Every statement is additive and idempotent (`tests/schemaDdl.test.ts`).
  A second creator is how `session` came to exist on one database and nowhere else.
- **`session` table** — `createTableIfMissing: false`, deliberately absent from
  `shared/schema.ts`, excluded from drizzle-kit by `tablesFilter` so push never asks whether
  a new table is a rename of it. Clear its rows; never drop it while the server runs.

## Invariants — each is a bug that shipped

Verify against source before changing any.

- **Server authority.** The server validates every move and broadcasts sanitized state.
  Never trust client state for an outcome.
- **Ticket auth only.** The handshake accepts a live session or a single-use ticket. A bare
  `handshake.auth.userId` branch was a full impersonation vector.
- **Listener registration precedes every `await`** in the socket connection handler.
  Socket.io drops events with no listener attached, and the client emits `game:rejoin`
  synchronously on connect.
- **Socket singleton** — one socket per userId via `lib/socket.ts`; `SocketContext` owns the
  lifecycle.
- **Hooks before the null guard** in both game screens — every hook runs before
  `if (!gameState) return null`.
- **A card appears exactly once** in flight/`pileState` — never twice, never zero times.
- **`CARD_W`/`CARD_H` are declared once**, in `components/cardFaceModel.ts`; `handLayout.ts`
  and `gameTableModel.ts` re-export them. The web substitutes for safe-area insets,
  `WEB_TOP_PAD`/`WEB_BOTTOM_PAD`, are declared once in `lib/tokens.ts`.
  `tests/gameTableModel.test.ts` source-scans for a second declaration — pinning the value
  cannot find one, because a copy holds the same number.
- **Impact feedback is timed to the card landing**, not the throw. `impactDelayMs()`
  (`components/gameTableModel.ts`) is the one place that delay is derived, so the animation
  and the feedback cannot drift apart.
- **Design tokens are used in the role they were named for.** A fill or border token used as
  a text colour renders as almost nothing, silently. Pinned by `tests/tokenRoles.test.ts`.
- **A labelled control exposes one accessible node.** `Pressable` defaults `accessible` to
  true, which does *not* remove children from the tree — hide decorative ones explicitly.
- **Every `<Modal>` declares `supportedOrientations` including landscape**, or iOS rotates
  the app to portrait behind it. Pinned by `tests/orientation.test.ts`.
- **`NotificationBanner`** never returns null, and animates by callback chain — parallel
  `withTiming` calls overwrite the slide-in.
- **`OfflineBanner`** flags offline only on `state.isConnected === false`; `null` is unknown.
- **Game invites** set `pendingInvite` *before* showing the banner. Banner only, no Alert.
- **Game rules** live in `lib/gameEngine.ts`, specified by `docs/RULES.md`. Change them only
  via a decision recorded in `docs/BRIEF.md` §3.1.

## Comments

**Default is no comment.** Code is the documentation. Before keeping one, ask: would a
competent reader learn something the code wouldn't have told them in ten seconds? If not,
delete it — rename or extract instead.

Four things earn one: an invisible constraint (an ordering that prevents a race, a platform
quirk); a *why* where the obvious approach is wrong and someone will "fix" it back; a
contract the types can't carry; a pointer to the authority.

Never: restating the line below; any history of what it was or when it was fixed;
**explaining the defect you just fixed** — that belongs in the commit message. The code
should read as if the bug never happened. A change adding more comment lines than code
lines is explaining itself instead of being clear.

## Design system

- **No bare literals for colour, radius, font size, spacing or timing** — all from
  `lib/theme.ts`, and `eslint.config.js` refuses a bare number for any of them. A
  component-local one-off may be a named module constant. `0` is still a plain `0`.
- Gold is a five-step alpha scale (`goldGhost` … `goldStrong`). Pick by role; don't add a
  sixth to split the difference.
- Menu screens use `MenuLayout` / `MenuCard` / `MenuButton`; `app/lobby.tsx` is the
  reference. The game tables, `app/index.tsx` and `app/result.tsx` are deliberately exempt.
  **A local
  component must not share a name with a shared one** — a duplicate `MenuButton` once hid a
  bug in plain sight.
- **Every user-facing string goes through `t()`**, keyed in all three locales.
- `Shadow.*` is platform-aware. Game screens are landscape-locked; menus do both via
  `useWindowDimensions`. Use `useSafeAreaInsets()` in game and layout components.

## Working agreement

- **Autonomy.** Work the queue one item at a time, one commit per item. Don't ask which item
  or whether to proceed. Record genuinely owner-level choices and take the next item.
- **No workarounds.** If the correct fix is bigger, do the correct fix. Look up current best
  practice rather than guessing.
- **Design first** for anything touching storage, the socket protocol, or many files.
- **The database is not precious.** No real users. Prefer dropping and recreating over
  accreting compatibility. Order by design, not deploy cost: derive from existing rows →
  ride an existing jsonb column → new table → new column.
- **Leave no residue.** Implemented design docs, superseded plans and scratch scripts get
  deleted, not archived. A claim that no longer holds is removed the moment it's found.
- **No self-defeating safeguards.** Never ship a guard together with the thing that gets past
  it. **The tell is the justifying comment.** A check that cannot fail costs the same as a
  real one and buys false confidence. This has recurred three times here — in CI, in an
  accessibility label, and in a constant the test couldn't detect a second copy of.

## Known pitfalls

- `Cannot read property 'cards' of null` — null-check game state before `.cards`.
- `REPLACE navigation action not handled` — the `index` route must exist before navigating.
- React Compiler can miscompile `useEffect` references. It comes from
  `babel-preset-expo`'s own dependency — do not add a second copy to `package.json`;
  `tests/reactCompiler.test.ts` pins that there is only one.

## Audit remediation in progress

125 findings in `audit/2026-08-17/`, executed in 15 batches. **Run `/batch <n>` — do not
improvise an implementation prompt.** `PROGRESS.md` holds the queue, per-batch treatment and
run order; `DECISIONS.md` holds settled answers (do not re-open them). While this is live,
that backlog outranks `docs/BACKLOG.md`.
