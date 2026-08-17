# REJECTED — claims the audit generated and then killed

The brief asked to see this explicitly. Three sources feed it: claims the orchestrator
disproved, findings the specialists self-scored below the 80 threshold and dropped, and one
error in the audit's own recon that propagated into two agent briefs before it was caught.

Nothing here is a finding. Everything here is something that looked like one.

---

## 1 · Killed by the orchestrator

### The recon map was wrong about the 3♠ opening rule — and I propagated it

**The claim.** `00-repo-map.md` §7 stated that the start-card rule is enforced by
`server/socket.ts:1430-1440` and `context/GameContext.tsx:347-352` but that
"`GameTable` does *not* re-check it". I carried that into the A2 brief and, worse, into the
B3 brief with the instruction *"A silent rejection is a High."*

**Why it is false.** `components/GameTable.tsx:476-481`:

```ts
const requiresStartCard = !gameState.firstPlayMade && !!gameState.startCard;
const isValidPlay =
  tentativeCombo !== null &&
  canPlay(tentativeCombo, isNewRound ? null : gameState.lastPlayedCombination) &&
  (!requiresStartCard ||
    tentativeCombo.cards.some((c) => c.id === gameState.startCard!.id));
```

The client enforces it. A2 additionally confirmed `startCard` survives
`sanitizeStateForPlayer` (`server/socket.ts:249-266` spreads `...state`), so it is populated
on the client when it matters. **There is no lit-button-then-server-rejection path on the
opening turn.**

**Who caught it.** A2, unprompted, in the middle of its own scope — and it put the correction
at the top of its report rather than burying it. B3 reached the same conclusion independently
before my correction message arrived, and wrote no finding.

**What I did.** Verified by reading the file myself; corrected `00-repo-map.md` §7 in place
with a marked CORRECTION block; messaged B3 mid-run to drop the line of inquiry and delete
anything built on it. No finding in any report rests on the false claim.

**Why it is in this file.** A recon error that reaches four agent briefs is exactly the
failure mode this audit was supposed to catch in the code, and it happened to the audit
itself. The lesson is in SUMMARY.md.

---

### "`vacateSeat`'s game-over branch has no reachable caller" — overstated, softened

**The claim.** A3, inside NET-01: `vacateSeat`'s `if (game.gameState.gameOver)` branch
(`server/socket.ts:664-677`) "has **no reachable caller**".

**Why it is overstated.** The disconnect **grace timer** at `:1957` calls `vacateSeat`
unconditionally 60 seconds after arming. It is armed only when `!gameOver` (`:1924` gates it)
— but if the hand *ends* inside that 60-second window, the callback still fires and the branch
does run.

**Resolution.** The reachability sentence is softened in BACKLOG.md; **NET-01 itself survives
unchanged.** Its substantive claim — that neither leave path removes a departed player from
`playerMap`, deadlocking the unanimous rematch gate at `:1545` — is verified and correct, and
the fix is identical either way. Reachable only through a narrow race is not the same as
reachable by design.

---

## 2 · Dropped by the specialists on self-scoring

Each agent was required to score every candidate 0–100 on "would an independent reviewer with
the file open agree this is real, on this line, today?" and delete anything below 80. Their
scores, verbatim.

### A1 — Security

| Dropped claim | Score | Why it failed |
|---|---|---|
| `DELETE /api/users/me` has no rate limiter — *flagged by recon as a lead* | **40** | Self-limiting: the first call destroys the session, every later one 401s at `requireAuth`. The real problem with that route is SEC-03, which is not about rate. |
| helmet `contentSecurityPolicy: false` as a standalone finding | 55 | No reachable XSS sink in the react-native-web SPA. Folded into SEC-07's fix instead of double-counted. |
| `game:rejoin` calls `disposeGame` before the authz check (`socket.ts:1671`) | 60 | Only reachable after a `GAME_SCHEMA_VERSION` bump, when the row is already unrestorable. |
| socket.io CORS callback returns `false` rather than rejecting | 50 | No impact: `sameSite: "lax"` means no cookie rides a cross-site WS handshake, so the connection fails auth regardless. |
| Hardcoded `SESSION_SECRET` in `scripts/e2e-server.mjs` | 25 | Local disposable stack only. |
| Logout omits `res.clearCookie` | 35 | The session row is destroyed; the stale cookie is inert. |

### A2 — Rules

| Dropped claim | Score | Why it failed |
|---|---|---|
| Turn direction is "counter-clockwise", contradicting the UI | **10** | Verified it renders clockwise via `seatDirection`. Correct as-is. |
| `resolveMatch` escalates on 23-vs-21 at target 21 | 40 | Matches `docs/RULES.md:123` literally — "two or more *reach* 21". |

### A3 — Netcode

| Dropped claim | Score | Why it failed |
|---|---|---|
| `persistGameState` is not awaited | ~65 | The envelope is a whole snapshot, so a failed write cannot corrupt the row — only the last write before a process death is lost. Documented factually in A3's Persistence walkthrough instead. |
| Out-of-order `active_games` upserts under pool contention | ~50 | Could not construct a concrete failure path; writes are normally >1 s apart. Moved to Coverage gaps. |
| `socket.off("game:started")` removes all listeners | ~55 | One listener exists today (an empty function). Moved to Opinions. |
| Duplicate `game:player_reconnected` on rejoin | ~60 | Cosmetic. Moved to Opinions. |

### A4 — Resilience

| Dropped claim | Score | Why it failed |
|---|---|---|
| `/api/client-errors` has no reporter | ~75 | True, but only as a *consequence* of RES-01 (the fallback that would report never renders). Folded into RES-01 rather than double-counted. |
| `installProcessGuards` never exits on `uncaughtException` | ~70 | The concrete harm only lands via the uncontained timers, so it is RES-04's second fix step. |
| `notifyUser` fetch has no timeout | 55 | Negligible impact. → Opinions. |

### B1 — Performance

| Dropped claim | Score | Why it failed |
|---|---|---|
| `persistGameState` per-move upsert, ~324 KB jsonb/hand | 55 | **Measured.** Nobody notices at this scale; the tradeoff is documented in the code. |
| `broadcastGameState` per-recipient clone | 40 | **Measured at 6.2 KB/broadcast**, and the clone is a security requirement (`sanitizeStateForPlayer`). |
| All three locales bundled eagerly, 147 KB source | 60 | Real but dwarfed by PERF-04; the typed-key design is worth more than the bytes. |
| pg Pool default `max:10`, sweeper fan-out, duplicate `getFriends` | 50–70 | No demonstrated consequence. |
| Card-art oversampling at DPR 1 | 55 | Correct at DPR 3; only on-screen courts are fetched. |
| List virtualisation | — | **No finding exists.** Every list is server-capped and the only `FlatList` is fine. |

### B2 — UI visual

| Dropped claim | Score | Why it failed |
|---|---|---|
| Friends-list row names lack `numberOfLines` | 55 | A 30-char name wraps and grows the row; nothing breaks. |
| `GameOverOverlay` action buttons ~36pt vs the 44pt convention | 70 | Real, but it is B4's accessibility scope — and B4 filed it as A11Y-09. Correctly routed rather than duplicated. |
| `app/index.tsx` portrait/landscape style duplication | 40 | Taste. |

### B3 — UX & game feel

| Dropped claim | Score | Why it failed |
|---|---|---|
| The start-card client/server divergence | — | **Confirmed false before the orchestrator's correction arrived.** No finding written. See §1. |
| "Loser gets a success haptic" as a standalone | 65 | Folded into UX-03's fix (same three lines). |
| `ExchangeAnnouncement` blocks for 5.5 s | 55 | It is dismissible. → Opinions. |

### B4 — Accessibility & mobile

| Dropped claim | Score | Why it failed |
|---|---|---|
| `KeyboardAvoidingView behavior="height"` on Android with `adjustResize` | 65 | Needs a device to confirm. → Coverage gaps. |
| `bgCard` on `goldDim` GIOCA pressed-state at 4.27:1 | 65 | Marginal and transient. |
| `NotificationBanner`'s unhidden `Text` children as an a11yCollapse violation | 70 | `role=button` / `role=alert` is a leaf on web, so no real double-announce. → Opinions. |
| mobile-web `overscroll-behavior` / pull-to-refresh | — | **Could not verify without building.** Moved to Coverage gaps and flagged as the one scope item B4 could not answer. |

### C1 — Architecture

| Dropped claim | Score | Why it failed |
|---|---|---|
| A `lib/gameEngine.ts` split proposal | ~70 | C1 had a named seam but **no honest benefit**: the server imports `aiChoosePlay`, so there is no boundary to buy and no bundle win. Dropped with that reasoning stated — the right call, and the brief banned split proposals without a named benefit. |
| `OnlineGameContext`'s inconsistent `useCallback` deps | 55 | Cosmetic; both forms are correct. |

### C2 — Testing, build & supply chain

| Dropped claim | Score | Why it failed |
|---|---|---|
| `test-renderer@^1.2.0` looks like a typosquat — *flagged by recon as a lead* | **10** | It is a **required peer dependency** of `@testing-library/react-native@14`, authored by the RNTL maintainer. Recorded as a resolved non-finding. |
| Lockfile licence risk | 5 | 1419 packages, all permissive. No GPL/AGPL. |
| `patches/expo-asset` staleness | 55 | The patch verifiably still applies. The transitive-float fragility went to Opinions. |
| "The 11 integration suites skip locally" | — | Excluded by the brief as a known false positive: CI makes the skip fatal at `ci.yml:67-74`. |

---

## 3 · Recon leads that did not survive

Three of the concrete leads the recon handed to the specialists were investigated and killed.
Recording them so they are not re-raised next time:

1. **`DELETE /api/users/me` has no rate limiter** → A1 scored it 40. Self-limiting.
2. **`test-renderer` is an odd dependency name** → C2 scored it 10. It is a legitimate RNTL
   peer dependency.
3. **`EXPO_PUBLIC_E2E_FAST` could leak into a production bundle** → A1 traced every path and
   found it set in exactly one place (`scripts/e2e-server.mjs:34`), by a script the Replit
   build chain never invokes, writing into a gitignored `dist/`. **Not a finding.**

Two recon leads *did* survive and became findings: `context/InviteContext.tsx` as dead code
(→ ARCH-14) and the two listener-less server events (→ ARCH-08, merged with NET-10).

---

## Tally

| | Count |
|---|---|
| Filed by specialists | 120 |
| Merged into another finding | 7 |
| **Surviving findings** | **113** |
| Self-scored below 80 and dropped before filing | 31 |
| Killed or corrected by the orchestrator | 2 |

The 31 self-dropped candidates are the number worth noticing: the agents deleted roughly a
fifth of what they found, with a recorded score and a stated reason for each. Several of the
drops (the measured performance ones, the `test-renderer` peer dependency, the turn-direction
claim) are results in their own right, and are cited as such in SUMMARY.md.
