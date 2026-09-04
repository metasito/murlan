# Murlan

Traditional Albanian card game (Big Two family), as an Expo app served as web by an Express +
Socket.io server on Replit. A *manche* is one hand; a *partita* is the match they add up to.
**English (`locales/en.ts`) is the source of truth for UI copy** — `it.ts` and `sq.ts` are
`Record<keyof typeof en, string>`, so a missing key is a compile error.

**This file is only what you cannot get by reading the code.** Stack, file layout and game rules
are deliberately absent: `package.json`, `ls` and `docs/RULES.md` never go stale.

## Where the rest lives

- `docs/agents/RULES.md` — every rule an agent follows, numbered, one screen. The only normative
  list; nothing here or in a prompt restates it (`tests/rulesAreSingleSourced.test.ts`).
- `docs/agents/issue-tracker.md` — the queue, labels, claiming, the `gh` invocations. Issues live
  in GitHub Issues (`metasito/murlan`).
- `docs/agents/loops.md` — which check catches what, what each costs, the local ports, and the
  React Native Web traps that pass every test and render nothing.
- `docs/adr/README.md` — decisions, indexed. A game-rule change is recorded in `docs/BRIEF.md` §3.1.

## Replit — breaking any of these takes production down

- Port from `process.env.PORT`, database from `process.env.DATABASE_URL`. `DATABASE_URL`,
  `SESSION_SECRET` and `PORT` must be set in Replit Secrets.
- No build step needing local tooling: it must launch from the Run button with no setup.
- **Production runs Node 22** (`.replit` `modules`). `server:build`'s `--target=node22` lowers
  *syntax* only, so a Node-24-only builtin compiles at exit 0 and throws on Replit. CI's `build`
  job is the one that catches that.
- **`server/schemaDdl.ts` is the only thing that creates tables**, at boot, from
  `shared/schema.ts`. Every statement is additive and idempotent (`tests/schemaDdl.test.ts`).
  A second creator is how `session` came to exist on one database and nowhere else.
- **`session` table** — `createTableIfMissing: false`, deliberately absent from
  `shared/schema.ts`, excluded from drizzle-kit by `tablesFilter`. Clear its rows; never drop it
  while the server runs.

## Invariants — each is a bug that shipped

Verify against source before changing any.

- **Server authority.** The server validates every move and broadcasts sanitized state. Never
  trust client state for an outcome.
- **Ticket auth only.** The handshake accepts a live session or a single-use ticket. A bare
  `handshake.auth.userId` branch was a full impersonation vector.
- **Listener registration precedes every `await`** in the socket connection handler. Socket.io
  drops events with no listener, and the client emits `game:rejoin` synchronously on connect.
- **One socket per userId** via `lib/socket.ts`; `SocketContext` owns the lifecycle.
- **Hooks before the null guard** in both game screens — every hook runs before `if (!gameState)`.
- **A card appears exactly once** in flight/`pileState` — never twice, never zero times
  (`tests/gameTableModel.test.ts`, `advancePile`).
- **`CARD_W`/`CARD_H` are declared once**, in `components/cardFaceModel.ts`; `handLayout.ts` takes
  a width as a parameter rather than importing it. Pinned by a source scan, because pinning the
  value cannot find a copy holding the same number.
- **Impact feedback is timed to the card landing**, not the throw — `impactDelayMs()` is the one
  place that delay is derived, so animation and feedback cannot drift apart.
- **Which view covers which is stated, never left to sibling order.** Felt `zIndex: 0`, game
  table `zIndex: 1`. Web and Android paint in tree order; iOS does not, and #209 cost three
  sessions to that.
- **A native-only visual defect is diagnosed from device pixels, not from reasoning.** Sample
  first (`docs/agents/loops.md`); a fix argued from the code alone gets one thing right and two
  wrong, on the owner's phone, each round.
- **The table's scale comes from the window's own short edge**, never that minus the safe-area
  insets. The safe area is the layout's job — the rail absorbs the cutout, the hand zone carries
  the home indicator.
- **Design tokens are used in the role they were named for.** A fill or border token used as a
  text colour renders as almost nothing, silently (`tests/tokenRoles.test.ts`).
- **An icon name reaches `<Ionicons>` as a literal**, or a ternary between two literals.
  `scripts/iconSubsetChars.mjs` cannot see through a JSX spread, so `<IconButton {...props} />`
  ships a blank box with no error. Every wrapper passes props by name.
- **A winner is stated as an engine player id (`player_N`)** — the only identity every client can
  map at every moment `game:over` can arrive, and the only one surviving a vacated seat.
- **One module chooses a bot's move**: `lib/autoMove.ts`, for the server and the offline table
  both. It once landed with only the server calling it and every check stayed green.
- **A labelled control exposes one accessible node** — hide its own words and glyphs with
  `a11yHidden()`. A web defect only: `Pressable`'s `accessible` default makes the view a UIKit
  leaf on iOS, and react-native-web forwards the prop nowhere. A live region announces rather
  than being landed on, so it is a node of its own (`A11yStatus`) and never a control.
- **A labelled *container* is the same shape with the opposite remedy.** What makes a label
  reachable is a role — a role-less `<div aria-label>` is `generic`, for which a name is
  prohibited. `a11yGroup()` carries both halves. A container holding a control must not be
  grouped at all: on iOS the control is sealed inside the leaf.
- **Every `<Modal>` declares `supportedOrientations` including landscape**, or iOS rotates the app
  to portrait behind it and every tap lands on nothing. **`components/AppModal.tsx` is the app's
  only `<Modal>`** (`tests/orientation.test.ts` pins both).
- **`NotificationBanner`** never returns null, and animates by callback chain — parallel
  `withTiming` calls overwrite the slide-in.
- **`OfflineBanner`** flags offline only on `state.isConnected === false`; `null` is unknown.
- **Game invites** set `pendingInvite` *before* showing the banner. Banner only, no Alert.
- **No self-defeating safeguards.** A check that exempts what it is checking, a ratchet that
  loosens itself, a suspend knob with no floor under it, a `--yes` baked into a destructive
  script — each is a guard that reports green by not looking. If a safeguard can be satisfied
  without the thing it guards being true, it is worse than none.
- **Game rules** live in `lib/gameEngine.ts`, specified by `docs/RULES.md`. Change them only via a
  decision recorded in `docs/BRIEF.md` §3.1.

## Design system

- **No bare literals for colour, radius, font size, spacing or timing** — all from `lib/theme.ts`.
  `eslint.config.js` refuses a bare number for radius, font size, spacing and timing; colour alone
  is convention. A component-local one-off may be a named module constant. `0` is still `0`.
- **Timing is `Motion`, and a duration that is not motion is not a `Motion` step.** How long a
  banner stays readable is `Reading`. What an animation becomes under reduced motion comes from
  `Motion.reduced` via `motionMs()`, never from the call site's judgement.
- Gold is a five-step alpha scale (`goldGhost` … `goldStrong`). Pick by role; don't add a sixth.
- **A `zIndex` is a `Layer` role, or is derived from one.** Only iOS reorders siblings, so a bare
  number is a claim nobody can check — three unrelated layers each chose 50 that way.
  `tests/tokenRoles.test.ts` resolves each through its module constant. `0` is `Layer.felt`.
- **Reach for the shared piece before writing one**: `ScreenHeader`, `StateBlock`, `IconButton`,
  `Avatar`, `ResultBoard`, `AppModal`, `useIsLandscape()`. A second copy of any is what #671
  removed. **A local component must not share a name with a shared one.**
- Menu screens use `MenuLayout` / `MenuCard` / `MenuButton`; `app/profile.tsx` is the reference.
  The game tables and `app/index.tsx` are deliberately exempt.
- **Every user-facing string goes through `t()`**, keyed in all three locales.
- `Shadow.*` is platform-aware. Game screens are landscape-locked; menus do both via
  `useIsLandscape()`. Use `useSafeAreaInsets()` in game and layout components.

## Comments

**Default is no comment.** Four things earn one: an invisible constraint (an ordering that
prevents a race, a platform quirk); a *why* where the obvious approach is wrong and someone will
"fix" it back; a contract the types can't carry; a pointer to the authority.

Never: restating the line below; any history of what it was or when it was fixed; **explaining
the defect you just fixed** — that belongs in the commit message. A change adding more comment
lines than code lines is explaining itself instead of being clear.

## Working agreement

- **Design first** for anything touching storage, the socket protocol, or many files.
- **The database holds real accounts.** `pg_dump` before a schema change, and read `db:push`'s
  rename-or-drop prompt rather than accepting it (`docs/DEPLOY-RUNBOOK.md`). Order a change by
  design, not deploy cost: derive from existing rows → ride an existing jsonb column → new table
  → new column.

## Known pitfalls

- `Cannot read property 'cards' of null` — null-check game state before `.cards`.
- `REPLACE navigation action not handled` — the `index` route must exist before navigating.
- React Compiler can miscompile `useEffect` references. It comes from `babel-preset-expo`'s own
  dependency — never add a second copy (`tests/reactCompiler.test.ts`).
- **`onLayout` reports a change of size, never one of position.** On web it is backed by a
  `ResizeObserver`, so a box that keeps its height while its `top` moves never fires again and
  anything derived from that `y` is silently stale. Take only the size from the event.
- **No unit test can see a layout bug.** `@testing-library/react-native` runs on
  `react-test-renderer`, which never runs flexbox. Only `tests/e2e/` (Playwright) catches this
  class — a card fan rendered off-screen for months against a green native suite.

## LOOP PROTOCOL

`.claude/commands/queue.md` is the only loop protocol in this repo, and the only place its
procedure is written down. Nothing here restates it (`tests/rulesAreSingleSourced.test.ts`).

The loop keeps no state file. Which ticket, what is committed, whether a review covers it — all of
it is derived from git and the tracker, so it cannot go stale, and a `SessionStart` hook reports it
on its own. If this session opened with a live run described to you, read
`.claude/commands/queue.md` and resume at the phase it names. Do not restart the ticket, and do not
ask whether to continue.

No file is off limits to the loop, and no file count is. What decides whether a change lands is the
review that read it, not which paths it touched. The invariants above still hold, and the schema and
Replit notes above say what a change to those costs; a diff reaching one of them is a diff the
review reads harder.
