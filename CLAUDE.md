# Murlan

Traditional Albanian card game (Big Two family): an Expo app, served as web by an Express +
Socket.io server. A *manche* is one hand; a *partita* is the match they add up to.

This file holds only what reading the code cannot tell you. Stack, layout and game rules live in
`package.json`, the tree and `docs/GAME-RULES.md`.

## Where the rest lives

- `docs/agents/RULES.md` — every rule an agent follows, numbered. The only normative list; cite a
  rule by number, never restate it (`tests/tooling/rulesAreSingleSourced.test.ts`).
- `docs/agents/issue-tracker.md` — the queue (GitHub Issues, `metasito/murlan`), labels, claiming,
  the `gh` invocations.
- `docs/agents/loops.md` — which check catches what and what it costs, local ports, the React
  Native Web traps that pass every test and render nothing.
- `docs/adr/README.md` — decisions, indexed. A game-rule change is recorded in `docs/BRIEF.md` §3.1.

## Production — breaking any of these takes it down

The host is being chosen (#1105; ADR-0006 retired Replit). `deploy/runtime.json` is the contract
any host must meet — Node and Postgres majors, SIGTERM grace, proxy hops, connections per
instance — and the server and tests read it.

- **Boot fails fast without its env** (`server/http/bootEnv.ts`): `SESSION_SECRET` and
  `DATABASE_URL` always; in production also `PUBLIC_HOST`, and a `DATABASE_URL` carrying an
  `sslmode`. `PORT` defaults to 5000.
- **Production runs `deploy/runtime.json`'s Node (22), not the repo's.** `server:build`'s
  `--target=node22` lowers *syntax* only, so a newer-Node builtin compiles at exit 0 and throws in
  production. CI's `build` job boots on that Node and is the one that catches it.
- **`server/store/schemaDdl.ts` is the only thing that creates tables**, at boot, from
  `shared/schema.ts`. Keep every statement additive and idempotent. The one exception: a unique
  index named in `DEDUPE_ON_BOOT` is preceded by a delete of the rows it would reject, or
  `CREATE UNIQUE INDEX` fails and the server does not start; `tests/server/schemaDdl.test.ts`
  allows that delete only for a listed index and only on its own key. A second creator is how
  `session` came to exist on one database and nowhere else.
- **`session` table**: `createTableIfMissing: false`, absent from `shared/schema.ts`, excluded from
  drizzle-kit by `tablesFilter`. Clear its rows; never drop it while the server runs.
- **Schema changes: `pg_dump` first, and read `db:push`'s rename-or-drop prompt** rather than
  accepting it (`docs/DEPLOY-RUNBOOK.md`). The database holds no real accounts yet, so a reshape
  loses nothing today — reject a design for losing data only once there is data; the habit is
  built before then. Order a change by design, not deploy cost: derive from existing rows → ride an
  existing jsonb column → new table → new column.

## Invariants — each is a bug that shipped

Verify against source before changing any.

**Server and protocol**

- **Server authority.** The server validates every move and broadcasts sanitized state; never
  trust client state for an outcome.
- **Ticket auth only.** The handshake accepts a live session or a single-use ticket; a bare
  `handshake.auth.userId` is an impersonation vector (`tests/integration/auth.test.ts`).
- **Register every listener before the first `await`** in the socket connection handler.
  Socket.io drops events with no listener, and the client emits `game:rejoin` synchronously on
  connect.
- **One socket per userId**, via `lib/socket.ts`; `SocketContext` owns the lifecycle.
- **A winner is an engine player id (`player_N`)** — the only identity every client can map at
  every moment `game:over` can arrive, and the only one surviving a vacated seat.
- **One module chooses a bot's move: `lib/game/autoMove.ts`**, called by the server
  (`server/game/gameTurn.ts`) and the offline table (`context/GameContext.tsx`) both. It once
  landed with only the server calling it, every check green.
- **Game rules live in `lib/game/gameEngine.ts`**, specified by `docs/GAME-RULES.md`. Change them
  only via a decision recorded in `docs/BRIEF.md` §3.1.

**The table**

- **Every hook runs before `if (!gameState)`** in both game screens, and game state is
  null-checked before `.cards` (`Cannot read property 'cards' of null`).
- **A card appears exactly once** in flight/`pileState` — never twice, never zero times
  (`tests/ui-rules/flightPhysics.test.ts`, `advancePile`).
- **`CARD_W`/`CARD_H` are declared once**, in `components/cardFaceModel.ts`; `handLayout.ts` takes
  a width parameter instead of importing it. A source scan pins this
  (`tests/ui-rules/layoutConstantsPinned.test.ts`), since pinning the value cannot find a copy
  holding the same number.
- **Impact feedback is timed to the card landing**, not the throw: derive the delay only from
  `impactDelayMs()`, so animation and feedback cannot drift apart.
- **The table's scale comes from the window's own short edge**, never that minus the safe-area
  insets. The safe area is the layout's job — the rail absorbs the cutout, the hand zone carries
  the home indicator.
- **State which view covers which with a `Layer` role** (or a value derived from one), never
  sibling order or a bare number: web and Android paint in tree order, iOS does not (#209).
  `Layer.felt` (0) < `Layer.feltScrim` (the bomb's) < `Layer.table`;
  `tests/ui-rules/tokenRoles.test.ts` resolves every `zIndex` through its constant.
- **Diagnose a native-only visual defect from device pixels, not reasoning.** Sample first
  (`docs/agents/loops.md`); a fix argued from code alone gets one thing right and two wrong, on
  the owner's phone, each round.

**UI components**

- **Use a design token in the role it was named for.** A fill or border token used as text colour
  renders as almost nothing, silently (`tests/ui-rules/tokenRoles.test.ts`).
- **Pass an icon name to `<Ionicons>` as a literal**, or a ternary between two literals, and every
  wrapper passes props by name. `scripts/iconSubsetChars.mjs` cannot see through a JSX spread, so
  `<IconButton {...props} />` ships a blank box with no error (`tests/tooling/iconSubset.test.ts`).
- **A labelled control exposes one accessible node**: hide its own words and glyphs with
  `a11yHidden()` (`tests/ui-rules/a11yOneNode.test.ts`). A web defect only — iOS makes the
  `Pressable` a leaf, react-native-web does not. A live region announces rather than being landed
  on, so it is its own node (`A11yStatus`), never a control.
- **A labelled container gets a role, via `a11yGroup()`** — a role-less `<div aria-label>` is
  `generic`, for which a name is prohibited. A container holding a control is not grouped at all:
  on iOS the control would be sealed inside the leaf.
- **`components/AppModal.tsx` is the app's only `<Modal>`, and it declares
  `supportedOrientations` including landscape**, or iOS rotates to portrait behind it and every tap
  lands on nothing (`tests/ui-rules/orientation.test.ts` pins both).
- **`NotificationBanner` never returns null, and animates by callback chain** — parallel
  `withTiming` calls overwrite the slide-in.
- **`OfflineBanner` flags offline only on `state.isConnected === false`**; `null` means unknown.
- **A game invite sets `pendingInvite` before showing the banner.** Banner only, no Alert.

**Checks**

- **No self-defeating safeguards.** A check that exempts what it checks, a ratchet that loosens
  itself, a suspend knob with no floor, a `--yes` baked into a destructive script — each reports
  green by not looking. A safeguard that can be satisfied without the guarded thing being true is
  worse than none.
- **No unit test can see a layout bug**: `@testing-library/react-native` runs on
  `react-test-renderer`, which never runs flexbox. Only `tests/e2e/` (Playwright) catches that
  class — a card fan sat off-screen for months against a green native suite.

## Design system

- **Colour, radius, font size, spacing and timing come from `lib/theme.ts`** (rule 18).
  `eslint.config.js` refuses a bare number for all but colour, which is convention. A
  component-local one-off may be a named module constant; `0` is still `0`.
- **Timing is a `Motion` step only when it is motion.** How long a banner stays readable is
  `Reading`. The reduced-motion form comes from `Motion.reduced` via `motionMs()`, never from the
  call site.
- **Gold is a five-step alpha scale** (`goldGhost` … `goldStrong`): pick by role, add no sixth.
- **Reach for the shared piece before writing one**: `ScreenHeader`, `StateBlock`, `IconButton`,
  `Avatar`, `ResultBoard`, `AppModal`, `useIsLandscape()`. A local component must not share a
  name with a shared one.
- **Menu screens use `MenuLayout` / `MenuCard` / `MenuButton`**, with `app/profile.tsx` as the
  reference. The game tables and `app/index.tsx` are exempt.
- **Every user-facing string goes through `t()`** (rule 19). English (`locales/en.ts`) is the
  source of truth; `it.ts` and `sq.ts` are `Record<keyof typeof en, string>`, so a missing key is a
  compile error.
- `Shadow.*` is platform-aware. Game screens are landscape-locked; menus do both via
  `useIsLandscape()`. Game and layout components use `useSafeAreaInsets()`.

## Comments

**Default is no comment, and the default is what almost every line gets.** Four things earn one: an
invisible constraint (an ordering that prevents a race, a platform quirk); a *why* where the obvious
approach is wrong and someone will "fix" it back; a contract the types can't carry; a pointer to the
authority. Name which of the four before you write it; if you cannot, it does not go in.

Never: restating the line below; any history of what it was or when it was fixed; **explaining
the defect you just fixed** — that belongs in the commit message.

A change adding more comment lines than code is explaining itself instead of being clear.

**That is a budget with a number, not a preference.** A change is over it when it adds more than six
comment lines — three in a test — *and* more comment lines than code; a change that adds no code at
all is over it at three. Counted against `origin/main`, over the whole branch, so committing between
edits buys nothing. `tools/loop/guard-comments.mjs` refuses the write and `npm run check:comments`
fails the branch. Write to the budget: a refused write has already cost the turn.

## Working agreement

- **Design first** for anything touching storage, the socket protocol, or many files.
- **Send independent commands together**: one `Bash` call joined by `&&`, or several tool calls
  in one message. Each turn re-reads the whole conversation (about seven cents at a working
  context); split only where a command needs the last one's output.

## Known pitfalls

- `REPLACE navigation action not handled` — the `index` route must exist before navigating.
- **React Compiler can miscompile `useEffect` references.** It comes from `babel-preset-expo`'s own
  dependency; never add a second copy (`tests/ui-rules/reactCompiler.test.ts`).
- **Take only the size from `onLayout`.** It reports a change of size, never of position: on web a
  `ResizeObserver` backs it, so a box whose `top` moves at the same height never fires again and a
  `y` read from it is silently stale.

## LOOP PROTOCOL

`.claude/commands/queue.md` is the only loop protocol, and the only place its procedure is
written down; nothing here restates it (`tests/tooling/rulesAreSingleSourced.test.ts`).

**In a loop process (`$LOOP_TURNS` is set)**, if this session opened with a live run described to
you, read `.claude/commands/queue.md` and resume at the phase it names — do not restart the
ticket, and do not ask whether to continue. Any other session gets one informational line about
the run, which is the loop's, and carries on with what it was asked. The loop keeps no state file:
a `SessionStart` hook derives the run from git and the tracker.

No file is off limits to the loop, and no file count is: what decides whether a change lands is
the review that read it. The invariants and production notes above still hold, and a diff reaching
one of them is read harder.
