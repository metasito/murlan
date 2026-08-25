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

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`metasito/murlan`), via the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Working loops

Which check to run for which change, what each costs, and the React Native Web traps that
pass every test and render nothing. See `docs/agents/loops.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily by
`/domain-modeling`). See `docs/agents/domain.md`.

---

## Replit — breaking any of these takes production down

- Port from `process.env.PORT`, database from `process.env.DATABASE_URL`.
- `DATABASE_URL`, `SESSION_SECRET`, `PORT` must be set in Replit Secrets.
- No build step needing local tooling. Must launch from the Run button with no setup.
- **Production runs Node 22** (`.replit` `modules`). CI's `build` job — the one that boots the
  real artefact — runs 22; the other two check dev tooling and run 24. `server:build`'s
  `--target=node22` lowers *syntax* only and has no API database, so a Node-24-only builtin
  compiles at exit 0 and throws on Replit. The Node 22 job is what catches that.
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
  Enforced by `tests/gameTableModel.test.ts`'s `advancePile` suite.
- **`CARD_W`/`CARD_H` are declared once**, in `components/cardFaceModel.ts`; `gameTableModel.ts`
  re-exports them, and `handLayout.ts` takes a card width in as a parameter rather than
  importing the constant itself. `tests/gameTableModel.test.ts` source-scans for a second
  declaration — pinning the value cannot find one, because a copy holds the same number.
- **Impact feedback is timed to the card landing**, not the throw. `impactDelayMs()`
  (`components/gameTableModel.ts`) is the one place that delay is derived, so the animation
  and the feedback cannot drift apart.
- **Which view covers which is stated, never left to sibling order.** The felt carries
  `zIndex: 0` and the game table `zIndex: 1` (`components/GameTable.tsx`). Web and Android
  paint siblings in tree order; the iOS renderer put the felt's pool *above* the seats, the
  pile, the hand and the buttons, and the game vanished behind a region with hard straight
  edges that moved with the lamp (#209). It cost three sessions, and every hypothesis that
  read the symptom as a missing render, a clip or an opaque overlay was wrong.
- **A native-only visual defect is diagnosed from device pixels, not from reasoning.** #209's
  own captures held the answer for days: felt colour was visible on *both* sides of the cut,
  which rules out anything black covering the table and leaves only the felt's own paint
  landing on top. Sample pixels first (`docs/agents/loops.md`); a fix argued from the code
  alone gets one thing right and two things wrong, on the owner's phone, each round.
- **The table's scale comes from the window's own short edge**, never from the short edge
  minus the safe-area insets. A phone and a browser at the same window size must draw the same
  table; taking the insets off here shrank the cards on device only, which is a divergence
  from the web design rather than a fit for it. The safe area is the layout's job — the rail
  absorbs the cutout (`railWidth`), the hand zone carries the home indicator (`HAND_ZONE_H`).
- **Design tokens are used in the role they were named for.** A fill or border token used as
  a text colour renders as almost nothing, silently. Pinned by `tests/tokenRoles.test.ts`.
- **A labelled control exposes one accessible node** — hide decorative children explicitly;
  `Pressable`'s `accessible` default does not do it for you. Pinned by
  `tests/native/a11yCollapse.test.tsx`.
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
  `lib/theme.ts`. `eslint.config.js` refuses a bare number for radius, font size and
  spacing only; colour and timing are convention, caught in review or not at all. A
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

**Every rule an agent follows lives in `docs/agents/RULES.md`** — numbered, one screen, no
rationale. It is the only normative list; nothing here or in a prompt restates it, and
`tests/rulesAreSingleSourced.test.ts` fails if something does.

The *why* behind a rule, and the commands it refers to, live in the reference docs:

- `docs/agents/issue-tracker.md` — the queue, labels, claiming, the `gh` invocations.
- `docs/agents/loops.md` — which check catches what, what each costs, the local ports.
- `.claude/workflows/ticket-pipeline.mjs` — what each pipeline stage does and why it is shaped
  that way.

Two things that are this project's shape rather than a rule, and so are stated only here:

- **Design first** for anything touching storage, the socket protocol, or many files.
- **The database holds real accounts.** `pg_dump` before a schema change, and read `db:push`'s
  rename-or-drop prompt rather than accepting it (`docs/DEPLOY-RUNBOOK.md`). Order a change by
  design, not deploy cost: derive from existing rows → ride an existing jsonb column → new table
  → new column.

## Known pitfalls

- `Cannot read property 'cards' of null` — null-check game state before `.cards`.
- `REPLACE navigation action not handled` — the `index` route must exist before navigating.
- React Compiler can miscompile `useEffect` references. It comes from
  `babel-preset-expo`'s own dependency — do not add a second copy to `package.json`;
  `tests/reactCompiler.test.ts` pins that there is only one.
- **No unit test can see a layout bug.** `@testing-library/react-native` runs on
  `react-test-renderer`, which never runs flexbox, so no native test can assert which side of
  a seat a card fan renders on. Only `tests/e2e/` (Playwright) catches this class — a card fan
  rendered off-screen for months against a green native suite.
