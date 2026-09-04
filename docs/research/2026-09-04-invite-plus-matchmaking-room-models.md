# Invite a friend + fill the rest by matchmaking: what shipped games actually do

Research date: 2026-09-04, for issue #840 ("Bringing friends and being matchmade are two rooms
that can never be one"). Builds on, and does not repeat,
`docs/research/2026-09-03-party-invites-and-seat-holds.md` (seat-hold lifecycle; already
resolved and merged as #903). This file answers the question that research raised and left
open: **how does a shipped game let a player bring a friend or two and have the rest filled by
matchmaking, in one room — and what does the player press?**

Citation standard: every claim carries a URL that was actually fetched; a claim with no source
says so plainly rather than being invented. Tiers:

- **T1** — official docs, the vendor's own store listing / marketing site, official support
  pages.
- **T2** — documented first-party platform party/matchmaking APIs (Photon, Xbox MPSD, Nakama).
  These publish real reservation semantics and are the strongest primary evidence for "the
  mechanism," even though none is Murlan's stack.
- **T3** — game-journalism or wiki description of a shipped feature's UX, not a spec.
- **Not found** — searched for directly and not located, stated rather than guessed.

---

## 1. Resolving the contradiction: Murlan Pro does *not* document the hybrid mode

The owner's claim — "in Murlan Pro you can invite your friend and play against 2 strangers" —
does not match what murlan.app's own marketing site describes, and the prior research quoted
only a fragment of that page. Fetched in full (2026-09-04), `https://www.murlan.app/` lists
exactly five modes, each with its own one-line description (T1, verbatim):

| Mode | Copy |
|---|---|
| Offline Practice | "Play Murlan offline against AI opponents and learn the rhythm before going online." |
| Ranked FFA | "Jump into public free-for-all matches with server-authoritative rules and ladder progress." |
| Ranked 2v2 | "Play opposite-seat team matches with public leaderboard rewards and partner strategy." |
| Private FFA | "Create an invite-code room for friends and fill open seats with AI when needed." |
| Private 2v2 | "Run friend-only team tables with opposite-seat partners, room codes, and host control." |

Every "public" mode is anonymous ladder matchmaking with no friend-invite mechanism described;
every mode that mentions inviting a friend is "Private," and its own empty-seat filler is
explicitly **AI, not strangers** ("fill open seats with AI when needed"). No mode combines
"invite one named friend" with "fill the rest via matchmaking against strangers." This is the
same strict public/private split the prior research (§2.5, §3) already found across six of
seven consumer games — the fuller mode grid here just makes it explicit that Murlan Pro itself,
re-examined in more depth, is not the exception the owner believes it to be, at least not on
any public record.

Google Play and App Store listings for the same app (`com.gaminations.murlan` /
`id1518649663`, and the near-identical `app.murlan.mobile`) were also fetched. They add nothing
mechanical: generic social copy ("invite friends to play," "create a private room and invite
friends," "unite friends, family, and fellow players") with no mode-level detail beyond what
the marketing site already states. <https://play.google.com/store/apps/details?id=com.gaminations.murlan>,
<https://apps.apple.com/us/app/murlan-pro/id1518649663> (fetch attempts 2026-09-04; the Apple
page 429'd and the Play page returned only generic marketing text, not a features list).

**Verdict, stated plainly: no source found for Murlan Pro doing what the owner described.**
Two explanations are both consistent with the evidence and this research cannot distinguish
between them:

1. The owner is describing an in-app mechanic that exists but isn't in any public-facing copy
   (plausible — this research had no way to install and run the closed-source app, per the
   task's own constraint against APK teardown beyond what's publicly documented).
2. The owner is recalling Murlan Pro's Private mode (invite a friend, AI fills the rest) and
   describing the AI-filled seats as "2 strangers" loosely, when they are in fact bots.

This is worth surfacing back to the owner directly rather than silently resolved either way —
it changes which convention "don't reinvent the wheel" actually points to. If (2) is true, the
owner's own named example is evidence *for* Candidate 3 below (private room, AI fill, no
stranger crossover), not against it.

---

## 2. The party-into-matchmaking mechanism, where it is genuinely documented

Three platform APIs publish, in detail, how an already-formed group of known players enters
matchmaking as a unit and has the remaining seats filled by people who were never invited.

### 2.1 Photon Realtime — `expectedUsers` / Slot Reservation (T2)

"To reserve slots there is an `expectedUsers` parameter in the methods that get you in a room
(`JoinRoom`, `JoinOrCreateRoom`, `JoinRandomRoom` and `CreateRoom`)... Photon can block a slot
for specific users and take that into account for matchmaking... The leader of a team does the
actual matchmaking and can join a room and reserve slots for all members."
<https://doc.photonengine.com/realtime/current/lobby-and-matchmaking/matchmaking-and-lobby>
(read via search extract 2026-09-04; direct fetch was blocked by the site's own bot-check
interstitial, so this is the vendor's documented text as surfaced by search, not a page render
this research could independently re-render — noted as a caveat on this one citation).
Mechanically: the party leader already knows the party's user IDs (assembled outside the room,
via friends/invites) and passes them at the moment of `JoinRandomRoom`/`CreateRoom`; Photon
subtracts those slots from `MaxPlayers` before matching anyone else in. **Not found**: a
published expiry/timeout for an `expectedUsers` slot that never arrives — searched directly
(`expectedUsers reservation timeout expire`) and Photon's own docs on this point were not
located; only the unrelated actor/player TTL (rejoin-after-disconnect) documentation surfaced.

### 2.2 Xbox MPSD + SmartMatch — "Reserved" as a first-class member state (T2)

"When SmartMatch creates matches, SmartMatch adds session members as user state Reserved,
meaning that each member takes up a slot but has not yet joined the session." SmartMatch groups
form as match tickets — a party's members ticket together — and "each group of new players
triggers a new initialization episode. When initialization is complete, each player either
succeeds or fails the process."
<https://learn.microsoft.com/en-us/gaming/gdk/docs/services/multiplayer/matchmaking/live-matchmaking-overview?view=gdk-2604>
(read 2026-09-04). This is the same shape as Photon: reservation is declared before the
stranger-filling happens, as a property of the group entering matchmaking, not as a live hold
inside a room strangers can already see.

### 2.3 Nakama — party-scoped matchmaker (T2)

"The matchmaker can be passed a party ID which instructs the matching logic to ensure that
enough capacity is reserved to join the match altogether... a very common Nakama-supported use
case for parties is to matchmake together in groups." Nakama also exposes match signals that
"mark a user ID or session ID into the match state ahead of their join attempt."
<https://heroiclabs.com/docs/nakama/concepts/parties/> (read 2026-09-04). Same convergence: the
party exists first (via Nakama's own party API), then is handed to the matchmaker as a unit,
which reserves the party's combined slot count against strangers being matched into the same
match.

**The convention, stated once:** all three treat "party" and "room/match" as two different
objects with two different lifecycles. The party is assembled first, by name, through a
friends/invite layer that has nothing to do with matchmaking; only once assembled does it enter
matchmaking, at which point the party's slots are reserved as a block and the matchmaker fills
the rest with strangers who were never aware the party existed until the match starts. None of
the three documents a model where a room is *first* opened publicly and *then* has one seat
carved out and held for a specific named person while strangers can already see and join the
rest of the room — which is closer to what Murlan does today (`heldSeats` in
`server/seatAllocation.ts`) than to any of these three APIs.

---

## 3. What the player actually presses

### 3.1 Apex Legends — a default-on "Fill" toggle next to mode select (T3, corroborated by two outlets)

"There's a 'fill matchmaking' checkbox next to the mode select in the lobby... with the box
checked, the game will operate like normal, filling your squad with one or two more people
depending on the game mode selected. If you uncheck that box, you will go alone in your chosen
mode. You can also go no-fill with a party, if you want to, say, play in a duo squad against
trios." <https://www.svg.com/351454/apex-legends-no-fill-matchmaking-explained/>,
corroborated at <https://www.dexerto.com/apex-legends/apex-legends-finally-adding-no-fill-option-for-solo-players-1526811/>
(both read 2026-09-04). Two things worth copying structurally: the toggle sits **next to mode
select**, not buried in a settings screen, and it is **on by default** — a player who does
nothing gets matchmaking; opting out is the deliberate action, not opting in. **Limitation
disclosed by the source itself**: "this will only work in standard modes — not ranked" — Apex
does not offer the toggle in its ranked queue at all, which is itself evidence that "public
ranked ladder" and "party-plus-fill" are, even here, kept as separate surfaces rather than one
universal toggle.

### 3.2 Hunt Showdown — an explicit opt-in to random teammates, not a default (T1/T3, official wiki)

"When opting-in to find a random partner in the Lobby, players can now choose between either
searching for two player or three player teams" — added in Update 1.2, which "allows players to
form and play with random teams of three instead of only being able to play in teams of three
with their Steam friends." <https://huntshowdown.fandom.com/wiki/Update_1.2> (read 2026-09-04,
fan wiki describing an official patch — weaker T1 than a vendor page, but describing a
documented shipped change, not speculation). The opposite polarity from Apex: here filling with
strangers is something the player turns **on**, not off. Combined with §3.1, both polarities
ship in real, successful games — there is no single industry-standard default, only the
principle that it is a visible, named toggle either way, never an implicit side effect of
another action.

### 3.3 Rocket League — matched, not toggled (T3, weak)

Rocket League's own support pages describe *how* an incomplete party is matched with strangers
(skill-weighting rules) but not a UI element the player presses to opt in or out — search did
not surface one. <https://www.epicgames.com/help/en-US/rocket-league-c5719357623323/gameplay-c7262179951387/rocket-league-party-skill-and-matchmaking-a5720141173147>
(read 2026-09-04). Included because it is instructive by omission: some shipped games treat
"party smaller than a full team gets filled by matchmaking" as the *only* mode, with no toggle
at all, because there is no private-room alternative to switch away from. This is a third shape
distinct from both Apex's and Hunt's: **no choice presented, because the game has only one room
type to begin with.**

---

## 4. Privacy: a room becoming visible to strangers

**This is the weakest-sourced section.** No primary source in this research — not Photon, not
Xbox MPSD, not Nakama, not any of the seven consumer games in the prior research pass, not
Apex, not Hunt — documents a room that starts **private** and is later, explicitly, flipped to
**public** by a host action, the way #840's own open question ("can an opened room close
again") implies Murlan might do. The reason is structural, not an oversight in this research:
every sourced example in §2 keeps the party and the room/match as separate objects, so there is
never a "this room was private, now it's public" transition to document — the room is public
(or matched) from the moment it exists, and the party's privacy lives entirely in how its
members were invited, not in the room's own visibility flag. Murlan's `rooms.visibility`
column, written once at creation and never updated (`server/socketRooms.ts:47` hardcodes
`"private"` for `room:create`, `:261` hardcodes `"public"` for `room:quickmatch`), is exactly
the field that would need to become mutable to build the transition the ticket's checklist
asks about — and this research found no shipped precedent, at any tier, for what that
transition should look or feel like to the player. **Not found**, stated plainly rather than
invented.

---

## 5. What this means for #840

Three candidate designs, each concrete about the interaction and each traceable to a specific
piece of sourcing above, mapped onto what already exists in `server/socketRooms.ts`,
`server/seatAllocation.ts`, `server/storage.ts` (`findWaitingPublicRooms`), and
`app/(online)/quickmatch.tsx` / `app/(online)/room.tsx` (`fillWithBots` toggle already built).

### Candidate 1 — One flow, always public, friends are orthogonal (Photon/Xbox/Nakama shape)

**What the player presses:** Quickmatch screen (already built) — pick a mode, optionally tap
"Invite friends" before or after pressing the mode card, press nothing else. There is no
create/quickmatch fork any more: `room:create`'s `"private"` hardcode goes away, and every room
a player opens is `"public"` from the moment it exists, exactly like `room:quickmatch` already
does. Inviting a friend sends a `game:invite` the same as today; `heldSeats` reserves their seat
on the inviter's side exactly as it already does for 2v2. Strangers arrive through the existing
`room:quickmatch` → `findWaitingPublicRooms` → `seatForClaim` path, which already correctly
skips seats `heldSeats` is holding.

**Empty seat / bots:** offered (not forced) once a configurable wait elapses with seats still
open — the `fillWithBots` toggle in `room.tsx` already exists; this candidate turns it from a
host-set-it-in-advance checkbox into a prompt that appears after the wait, per the owner's own
"propose bots after a while but don't force them."

**Advantages:** smallest conceptual model — "how many friends did you bring" really does become
"zero to `maxPlayers - 1`," as the ticket's own proposed rule states. Requires **no**
`rooms.visibility` mutation at all (§4's unsourced transition never has to be built, because
there is nothing to transition — every room is public from birth). Matches the structure all
three T2 platform APIs converge on.

**Disadvantages:** removes the "just my friends, closed to everyone" room entirely — the one
mode all seven consumer games in the prior research (Murlan Pro included, on its own marketing
copy) and Photon/Xbox/Nakama's "party-first, but the party can still choose not to enter
matchmaking at all" flexibility do not have to give up. A host who wants a fully private table
with bots and zero chance of a stranger arriving (Murlan Pro's actual "Private FFA"/"Private
2v2," per §1) has no equivalent here unless every seat happens to be filled by invited friends
before matchmaking has a chance to seat anyone else — which is a race, not a guarantee.

### Candidate 2 — An explicit, live, reversible "Open to matchmaking" toggle (Apex + Hunt Showdown shape)

**What the player presses:** the existing room screen (`room.tsx`) gets one more control next
to the invite panel — a toggle, default state to be decided (Apex defaults it on; Hunt Showdown
makes it an opt-in), labelled something like "Fill with matchmaking." Flipping it on turns the
room's `visibility` from `"private"` to `"public"` **live**, while the host is still sitting in
the lobby waiting on a friend — which directly answers the ticket's "can an opened room close
again" bullet, because flipping it back off is the same control. This is the one candidate that
requires `rooms.visibility` to become mutable and broadcast, not just written once — the
concrete schema/wire change the ticket's own ground-truth table flags as missing.

**Empty seat / bots:** same as Candidate 1 — offered after a wait, never forced, using the
existing `fillWithBots` machinery, but now scoped to "still-open seats after the toggle went
public," since a still-private room with the toggle off shouldn't be offering bots for a
seat nobody outside the friend group can see yet.

**Advantages:** most closely matches the owner's own "propose... but don't force" instruction,
because the host is making two separate, reversible calls (open to strangers; accept a bot)
rather than one irreversible one. It is the only candidate with a directly sourced UI precedent
for the control itself (§3.1, §3.2) rather than an inferred one.

**Disadvantages:** most new surface area — a mutable `visibility` column, a broadcast on every
change (same shape as the seat-hold's release broadcast fixed in #903, so there is a recent
precedent in this codebase for doing it right), and a UI decision this research found no single
converged default for (on vs. off) — Apex and Hunt Showdown ship opposite polarities, both
successfully, so "which default" is a judgment call this research cannot resolve from sourcing
alone.

### Candidate 3 — Keep the two entry points separate; add one one-way bridge (the actual Murlan Pro shape, per §1)

**What the player presses:** nothing changes about today's fork — Quickmatch stays "public,
matched with strangers, no invites," and "Create Room" stays "private, invite-code, host fills
with bots" (Murlan Pro's own two families of modes, §1's mode grid). The only new control is on
the private room's own screen: a host who invited a friend and still has empty seats can press
one explicit, one-directional action — "Open remaining seats to matchmaking" — which is
allowed to flip `visibility` to `"public"` exactly once, is stated as a privacy transition (per
the ticket's own constraint), and cannot be reversed by the host once pressed (matching the
one-shot, non-renewable character #903 already established for seat holds, and Steam
`ISteamParties`' one-shot reservation precedent from the prior research pass).

**Empty seat / bots:** offered after a wait, same mechanism as the other two candidates; the
difference is only that "open to strangers" and "fill with bots" become two buttons the host
chooses between, not a toggle plus an automatic prompt.

**Advantages:** smallest behavioural change from what's shipped today — Quickmatch and Create
Room stay exactly as intuitive (or as unintuitive) as they already are, and this candidate has
the strongest sourcing of the three for "this is the convention," now that §1 has re-examined
Murlan Pro in more depth and found no evidence it merges the two flows either. It also sidesteps
§4's biggest unsourced gap (a *reversible* public/private toggle) by making the one transition
that does exist one-way, which is the one pattern (Steam Parties, #903) this whole research
line has actual precedent for.

**Disadvantages:** does not deliver the owner's stated goal as directly as Candidate 1 or 2 —
the owner asked for "not too many rules or exceptions," and this candidate keeps the two-entry-
point rule the ticket itself was filed to question. It also does not resolve "1v1 with a friend"
cleanly: a 2-seat private room with one friend invited and the bridge not yet pressed has one
permanently-open seat with nothing filling it until the host acts, which is an extra step
Candidate 1 does not require at all.

**This research's own read:** Candidate 2 is the one most aligned with the owner's literal
words — "propose bots after a while but don't force them" already implies a live, adjustable
state rather than a single upfront choice, and it is the only candidate with sourced UI
precedent for the specific control (§3.1–3.2). But it is also the candidate requiring a genuine
design decision this research cannot make for the owner: the toggle's default polarity, and
exactly when in the flow it is first shown. Candidate 1 is the structurally cleanest and matches
every T2 platform API found, at the cost of removing the fully-private, zero-stranger-risk room
Murlan Pro itself appears to actually ship. Candidate 3 is the most convention-aligned with what
could actually be verified about Murlan Pro, but least matches "not too many exceptions."
