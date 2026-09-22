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
- `components/CLAUDE.md` — loaded when you read anything under `components/`: table and
  UI-component invariants, the design system.
- `server/CLAUDE.md` — loaded when you read anything under `server/`: the production contract,
  boot env, schema, and the server invariants.

## Invariants — each is a bug that shipped

Verify against source before changing any.

- **Every hook runs before `if (!gameState)`** in both game screens, and game state is
  null-checked before `.cards` (`Cannot read property 'cards' of null`).
- **One module chooses a bot's move: `lib/game/autoMove.ts`**, called by the server
  (`server/game/gameTurn.ts`) and the offline table (`context/GameContext.tsx`) both. It once
  landed with only the server calling it, every check green.
- **Game rules live in `lib/game/gameEngine.ts`**, specified by `docs/GAME-RULES.md`. Change them
  only via a decision recorded in `docs/BRIEF.md` §3.1.
- **No self-defeating safeguards.** A check that exempts what it checks, a ratchet that loosens
  itself, a suspend knob with no floor, a `--yes` baked into a destructive script — each reports
  green by not looking. A safeguard that can be satisfied without the guarded thing being true is
  worse than none.
- **No unit test can see a layout bug**: `@testing-library/react-native` runs on
  `react-test-renderer`, which never runs flexbox. Only `tests/e2e/` (Playwright) catches that
  class — a card fan sat off-screen for months against a green native suite.

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
the review that read it. The invariants here, in `components/CLAUDE.md` and in `server/CLAUDE.md`
all still hold, and a diff reaching one of them is read harder.
