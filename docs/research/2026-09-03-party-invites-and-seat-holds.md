# Seat holds during a pending friend invite: what shipped games actually do

Research date: 2026-09-03. Citation standard follows
`docs/research/2026-08-29-multiplayer-infrastructure.md`: every claim carries a URL that was
actually fetched, quotes are verbatim, and a claim with no source says so instead of being
invented. **These are closed-source consumer apps.** Most have no public technical
documentation of their internal reservation logic; where that is true, the tier below is
"observation" (what the game visibly does, from help pages, wikis, store listings, or forum
posts) rather than "specification." Sources are labelled by tier on every claim:

- **T1 — official docs/support/patch notes** for the named consumer games.
- **T2 — documented platform party/lobby APIs** (Steam, Discord, Xbox MPSD, Photon, Nakama,
  PlayFab). These publish real reservation semantics and are the strongest primary evidence
  available for "the convention," even though none of them is Murlan's stack.
- **T3 — game-design writing / forum synthesis**, not a primary source.
- **Not published** — stated plainly, not filled in with plausible-sounding invention.

---

## 1. The question, and what could and could not be sourced

Murlan currently: a host invites a friend to a specific 2v2 seat (`heldSeats` in
`server/seatAllocation.ts` only fires when the room has sides — free-for-all lobbies never
hold a seat, per that file's own comment: "a hold there would only cost a free-for-all lobby a
seat for two minutes. The three cases this exists for are all 2-v-2"). The hold lasts
`holdMs` (120000 in production) from the invite's `createdAt`, and `createdAt` is **restamped
on every re-invite** (`SeatInvite`'s doc comment: "`createdAt` is refreshed by
`recordGameInvite` on a re-invite, so the hold restarts with the asking") — so a host can hold
a seat indefinitely by re-sending. Decline frees the seat in the database but broadcasts
nothing, so onlookers see it held for up to 120s more.

What could be sourced: the *shape* of reservation in platform party/lobby APIs (T2) is well
documented — Steam, Xbox, Photon and Nakama all publish exactly how a slot is reserved for a
named/expected player, and two of them (Steam, Xbox) publish that the reservation is
explicitly one-shot with a timeout, never a renewable countdown. What could not be sourced:
the internal seat-hold *duration* or *renewal* logic of any of the seven named consumer games,
because none of them publishes it and none of them exposes the underlying protocol to
inspection. What the consumer games' own help pages and store listings *do* establish,
consistently, is which of the two structural options in the question (§5) they actually built.

---

## 2. Per game/platform

### 2.1 Ludo King / Ludo Star — private room + code (T1, observation)

Creating a table gives a six-digit room code; a friend joins by typing that code into "Join
Room." <https://www.coohom.com/in/article/how-to-join-a-room-in-ludo-king>,
<https://candid.technology/how-to-create-room-in-ludo-king/> (read 2026-09-03). No public
documentation states a seat-reservation duration for a specific invited friend, because there
is no such mechanic to document: the room is closed to anyone without the code, so there is
nothing to hold a seat *against*. **Not published**: any seat-hold timer, because none exists
in the described flow.

### 2.2 Stumble Guys — private party + code, no per-friend seat hold (T1)

"Tap the Party button on the Home Screen to create or join a Party... select 'Custom Party'...
you'll be given a unique code. Share this code with your friends so they can join your game."
<https://stumbleguys.helpshift.com/hc/en/4-stumble-guys/faq/73-how-can-i-play-with-my-family-friends-create-party/>
(read 2026-09-03). Up to 32 players, and empty slots can be filled with bots on host's choice —
again, a code-gated room, not a per-invitee seat reservation with a clock.
<https://gameskeys.net/how-to-play-stumble-guys-with-friends-multiplayer/> (read 2026-09-03).

### 2.3 Among Us — private lobby + code (T1)

"To create a private lobby... select 'Private'... you'll see a code... Friends will need to
input the code in the Private section." <https://leveldash.com/how-to-play-with-friends-among-us/>
(read 2026-09-03). Same shape: strangers are refused entirely, not held off a specific seat.

### 2.4 UNO Mobile (Mattel163) — Room Mode, private room + "Room Key" (T1)

"Room Mode is a game mode in 'UNO!' by Mattel163 that allows players to create and personalize
their own virtual rooms." <https://unogame.fandom.com/wiki/Room_Mode> (read 2026-09-03, wiki —
weakest end of T1). Mattel163's own promotion: "you need a Room Key to invite your closest
friends for a customized UNO game."
<https://www.facebook.com/UNOnow/videos/tip-of-the-day-wondering-how-to-invite-your-closest-friends-for-a-customized-uno/1011577255698333/>
(read 2026-09-03). Same private-room-by-key pattern as the three above.

### 2.5 Murlan Pro / Murlan.app — the owner's own named example, and it is a private room too (T1)

`murlan.app`'s own marketing copy: **"Private rooms with invite codes for friends,"** with
"invite-code room for friends" and the ability to "fill open seats with AI" and run
"friend-only team tables with opposite-seat partners, room codes, and host control."
<https://www.murlan.app/> (read 2026-09-03). This is the single most on-point data point in
this document: a *direct competitor implementing the same game*, named by the owner as one of
the examples to follow, ships the same private-room-and-code model as the other four —
**not** a public room with a per-seat, timed invite hold. Its page does not describe (and
this research could not find elsewhere) any per-seat reservation timer, because the
architecture has no stranger contention to defend against: a seat cannot be "taken by a
stranger" in a room strangers cannot enter.

### 2.6 Jackbox Party Pack — room code, no seats to reserve (T1)

"Each time you start a new game... generates a unique four-letter code... The purpose of
these codes is to ensure that only invited players can participate."
<https://www.jackboxgames.com/how-to-play> and coverage at
<https://smart.columbus.gov/columbus-news/jackbox-tv-room-codes-your-guide-to-joining-the-party-1764797795>
(read 2026-09-03). Same pattern again.

### 2.7 Fall Guys — party formed before matchmaking, via the platform's own party system (T1)

"To invite friends, log into your Epic Games account... press Open Party... select any of the
'Invite' buttons... press 'Invite'." <https://playerassist.com/how-to-invite-friends-in-fall-guys-ultimate-knockout/>
(read 2026-09-03); "For PC users, hit P... to bring up the party menu." Fall Guys uses Epic's
platform party layer to assemble the group **before** matchmaking finds or creates a session,
rather than inviting a friend into a specific seat of an already-open room. This is the
consumer-facing face of the "party-first" model that §2.8–2.11's documented APIs implement
underneath.

### 2.8 Board Game Arena — the one consumer game with a genuine per-seat, named reservation (T1/T3 mixed)

BGA is the sole example in this research of a *public, joinable table* that also lets the host
reserve one seat for a named person — structurally the closest analogue to Murlan's actual
feature. Forum description (T3, but describing an official feature): "When you open a new
table you got a white space for text under the players names. It says 'save a spot for'...
There you can write the name of the person you want to play the game with... the spot on your
table is then reserved for that player."
<https://forum.boardgamearena.com/viewtopic.php?f=3&t=4773> (read 2026-09-03). Two facts
about its lifetime, sourced from BGA's own forum but not from a dated technical spec (T3):

- The reservation is not on its own short clock. It lives as long as the **table** does:
  turn-based tables "stay open for 3 days waiting for enough players to start," and a table
  where everyone has gone offline "will be closed after 20 minutes to avoid cluttering the
  lobby." <https://forum.boardgamearena.com/viewtopic.php?t=21670> and search-summarised
  forum content at the same domain (read 2026-09-03). **No fixed re-arming exploit is possible
  here because there is nothing to restamp** — the clock belongs to the table's own
  abandonment logic, not to the individual reservation, so the host cannot "re-invite" to
  extend it; the table simply stays open until it closes for lack of any activity.
- **Not published**: whether the reservation is visible to other browsers of the lobby list
  beyond the named field on the table page itself, whether decline broadcasts anything, and
  whether an offline invitee's reserved seat is ever explicitly released before the table's
  own timeout. These questions were searched for directly (§ "reserved seat expire timeout")
  and returned no answer; BGA does not publish this level of internal behaviour.

### 2.9 Steam — `ISteamMatchmaking` lobby invite vs. `ISteamParties` beacon reservation (T2, official Steamworks docs)

Two distinct Steam mechanisms answer two different halves of the question:

- **Plain lobby invites** (`InviteUserToLobby`) do **not** reserve a slot at all. Steamworks
  documentation on this call and on lobby capacity states only that "a single lobby can have
  up to 250 users," with no mention of reserving a slot for an invited-but-not-yet-joined
  friend. <https://partner.steamgames.com/doc/features/multiplayer/matchmaking> (read
  2026-09-03). This is the plain "invite merely notifies, room stays open" half of Q1.
- **`ISteamParties`**, the "join a friend from outside the game" beacon system, *does* reserve,
  and its documented lifecycle answers Q2/Q3 directly for the one Steam mechanism that
  reserves anything: "Steam will hold a reservation slot for them and launch the game using
  the given connect string," but "Steam will eventually timeout their reservation and re-open
  the slot" if the invited player never completes joining, and the game must call
  `OnReservationCompleted()` once the player actually arrives, converting the reservation to
  an occupied slot. <https://partner.steamgames.com/doc/api/isteamparties> (read 2026-09-03).
  **This is the clearest documented precedent for "how long, and what happens on timeout" in
  this entire research, and it is a one-shot reservation with a hard timeout — nothing in the
  API lets the host indefinitely restamp it by re-inviting.**

### 2.10 Discord — Rich Presence / Social SDK invites: capacity is described, reservation semantics are not (T2, incomplete)

The invite payload carries party size and max size and a join secret; "when a player accepts a
game invite, you can use the join secret to connect the two players in your game."
<https://docs.discord.com/developers/discord-social-sdk/development-guides/managing-game-invites>
(read 2026-09-03). Discord's own documentation is explicit that seat/slot management is left
to the game: **"how you use it is up to you."** So Discord is evidence for the *party-first*
shape (party assembles via Rich Presence/Social SDK before the game session forms), but
**not published**: any Discord-side seat-hold duration, renewal, or decline behaviour, because
Discord deliberately does not own that layer.

### 2.11 Xbox MPSD — an explicit, first-class "reservation" concept, timing not published (T2)

Xbox's Multiplayer Session Directory documents `XblMultiplayerSessionAddMemberReservation`:
"When players are reserved, that means that they have been invited to the game session but
have neither accepted nor had their connections evaluated," and the arbiter must call
`PullReservedPlayersAsync`, which triggers "a UI notification or GameSessionReady notification
for all reserved players." <https://learn.microsoft.com/en-us/gaming/gdk/docs/services/multiplayer/mpsd/concepts/live-game-session-visibility-joinability?view=gdk-2604>
(read 2026-09-03). This confirms Q4's "is it a first-class, named state" affirmatively at the
platform level — reservation is its own visible member status, not an implicit inference from
an outstanding invite row. **Not published**: how long a reservation is held before MPSD
expires it automatically, or whether re-inviting resets that clock; the searched documentation
describes the state machine, not its timers.

### 2.12 Photon — `expectedUsers`, a party-first reservation baked into room join itself (T2)

"To reserve slots there is an `expectedUsers` parameter in the methods that get you in a
room... Photon blocks a slot for each of these UserIDs out of MaxPlayers... The leader of a
team does the actual matchmaking and can join a room and reserve slots for all members."
<https://doc.photonengine.com/realtime/current/lobby-and-matchmaking/matchmaking-and-lobby>
(read 2026-09-03). The reservation is declared **at room creation/join time**, as a list of
expected user IDs the party leader already knows about — the party is assembled first (outside
the room, via friends/invites), and the room is created carrying that party's roster. This is
the "party-first" structure, not "invite into an already-open room and hope."

### 2.13 Nakama — party-scoped matchmaking reservation, plus an explicit signal for in-match reservations (T2)

"The matchmaker can be passed a party ID which instructs the matching logic to ensure that
enough capacity is reserved to join the match altogether."
<https://heroiclabs.com/docs/nakama/concepts/parties/> (read 2026-09-03). Nakama also exposes
"match signals" that let a running match handler "mark a user ID or session ID into the match
state ahead of their join attempt," described in the same source. Same shape as Photon: the
party exists before matchmaking runs, and the reservation is a property of the party entering
the match, not of a lone invite into a seat.

---

## 3. The dominant convention, if there is one

There are two conventions, cleanly split by whether the room is public at all — and every
source in this research falls into exactly one bucket, with no example of a third.

1. **Private room + shareable code/key (T1, six of seven named consumer games, including the
   owner's own named competitor Murlan Pro).** No seat-hold exists because no stranger can
   ever contend for the seat: joining requires the code, full stop. Q1's "is a seat reserved
   at all" answer here is *the question doesn't arise* — the room itself is the reservation.
2. **Party-first, then the party enters (or is matched into) a session together (T2, all four
   documented platform lobby/party APIs, plus Fall Guys' consumer-facing flow in §2.7).** The
   reservation is declared once, as a roster the party leader already assembled, at the moment
   the party requests a room/match — never as a live countdown attached to a single outstanding
   invite inside a room other people can already see and join.

**Board Game Arena (§2.8) is the outlier that proves the rule by contrast.** It is the only
game found that does what Murlan does — hold one seat in an already-open, publicly joinable
room, for a specific named person. Its answer to "how long" is telling: it does **not** give
the reservation its own clock. The reservation lasts exactly as long as the table itself is
alive, and the table's own abandonment timeout (20 minutes with everyone offline, 3 days for
turn-based) is what eventually clears it — there is no separate "re-invite to restamp" surface
because there is nothing on the reservation to restamp.

No source, at any tier, describes a design where re-issuing the same invite extends a running
hold. That is not an omission in this research; the two platform APIs that publish timeout
behaviour in the most detail (Steam Parties, §2.9; Xbox MPSD, §2.11) both describe a
reservation as **one-shot**: it times out once, or it completes once. Murlan's restampable
120-second hold is not an instance of an industry pattern executed badly — it does not
correspond to any pattern found in this research at all.

---

## 4. Is seat-holding even the right primitive, or is party-first?

**Party-first is the dominant answer, and it is a stronger fit for what "invite a friend to a
seat" is trying to achieve than a seat hold is.** The owner's own instruction names three
examples; the sourcing in §2 shows two of the three (Ludo Star's lineage via Ludo King, and
Stumble Guys) plus the owner's own comparison app (Murlan Pro) all skip seat-holding entirely
by making the room private. The third documented ecosystem, the platform party APIs (Steam,
Xbox, Photon, Nakama — none of them party *games* but all of them the primary sources with
actual reservation semantics), independently converge on forming the party before the room
exists, so there is never a race between "a friend I invited" and "a stranger who got there
first" for the same seat — the room only comes into being already containing the party.

That said, two things keep this from being a clean "just delete the hold" verdict for Murlan
specifically:

- Murlan's hold is scoped to 2v2 team seats in an otherwise-public, joinable lobby — the
  free-for-all case already has no hold, by the file's own design (§1). The problem being
  solved is narrower than "reserve a seat in general": it is "let a host lock in a specific
  *partner*, opposite seat, while the room stays open to strangers for the other pair." That
  is closer to Board Game Arena's "save a spot for" (§2.8) — a public, otherwise-joinable room
  with one named reservation — than to any of the private-room games.
- None of the six private-room games needed to solve that problem, because none of them mixes
  "reserved for a friend" and "open to the public" in the same room at the same time. If
  Murlan's public lobby model with friend-held team seats is a deliberate design (mixed
  public/private occupancy), party-first doesn't directly replace it — it changes what "the
  room" is, not just what "hold" means within one.

---

## 5. What this implies for Murlan

Three options, not a single recommendation dressed up as three:

**A. Keep the hold as-is but fix its two defects (smallest change, weakest sourcing).** Make
`createdAt` immutable across re-invites (drop the restamp in `recordGameInvite`, or track
"first invited at" as the anchor `heldSeats` reads) so the countdown genuinely lapses, and
broadcast a `seat:released`-shaped event on decline so onlookers stop seeing a phantom hold.
This is directly supported by §2.9's Steam Parties precedent — a bounded, one-shot reservation
that either completes or times out, with completion (or in Murlan's case, decline) an explicit
event rather than a silent wait for the clock — and it does not touch the surrounding "public
lobby, held team seat" model this research found *no* precedent condemning as wrong on its own
terms. Cost: it keeps a bespoke mechanism no shipped game in this research was found to use in
this exact shape (a timed hold on one seat of an otherwise-open room), so there's no external
validation that 120s, or any fixed duration, is the right number — only that it should not be
renewable and should not linger past a known decline.

**B. Make it a renewable promise, deliberately, matching Board Game Arena's model.** Instead
of a short clock the host can silently restamp, tie the hold's lifetime to something the room
already has an abandonment policy for (or add one) — e.g., the seat is held until the room
itself is abandoned or the game starts, not until an arbitrary 120 seconds elapse. This is
what §2.8 actually does, and it removes the restamp bug by removing the thing being restamped:
there is no "renewal" action because there is no independent countdown to renew. Cost: this
is the one place in this document where the primary source is T3 (BGA's own forum, not a
dated technical page), so treat the "3 days / 20 minutes" figures as descriptive, not as
numbers to copy verbatim.

**C. Replace the seat-hold with a private/party-first room for the 2v2 case specifically.**
Since the defect only exists in 2v2 team rooms, and every consumer game sourced here (including
the owner's own comparison, Murlan Pro) solves "play a locked-in match with a specific friend"
by making the *room* private rather than holding one seat in a public one, the most
convention-aligned fix is to let a host who wants a specific partner create (or convert to) a
code-gated table for that pairing, leaving open/public 2v2 lobbies free-for-all like Murlan's
own free-for-all lobbies already are. This is the option with the strongest and widest sourcing
(six T1 examples plus four T2 platform APIs, §3) but the largest change: it is a room-model
decision, not a bug fix, and it changes what "inviting a friend to a seat" means for the player
rather than just how long the seat waits.

**This research's own read, stated plainly:** Option A is the correct near-term fix — it
directly answers the two problems in the prompt (indefinite restamp, silent decline) with the
one pattern this research found actual precedent for (Steam Parties' one-shot,
timeout-or-complete reservation). Option C is what "don't reinvent the wheel" points to as the
better long-run shape, per §4 and the owner's own named examples, but it is a room-model
change that deserves its own design pass rather than being folded into a bug-fix ticket for
the restamp/decline defects.

---

## 6. Not found / not published

- **No shipped consumer game's exact seat-hold duration or renewal logic** was found published
  anywhere, for any of the seven named games — these are closed-source apps and none of them
  documents this level of internal behaviour. Every consumer-game claim in §2 is about the
  *structure* (private room vs. open room, code-gated vs. not), never the *timing*.
  Ludo King/Ludo Star and Murlan Pro's marketing pages were the most direct sources available
  and neither publishes a seat-timeout number because, per §2.1 and §2.5, their model has
  nothing to time out.
- **Whether Board Game Arena's "save a spot for" reservation is visible to other players
  browsing the lobby list**, versus only to those who open the specific table, was searched
  for directly and not found in any BGA-published source.
- **Whether BGA broadcasts anything on decline**, or releases a reservation before the table's
  own abandonment timeout fires, was not found.
- **Xbox MPSD's own reservation timeout duration** (as opposed to the existence of the
  `AddMemberReservation` / `PullReservedPlayersAsync` mechanism) was searched for
  (`XblMultiplayerSessionAddMemberReservation reservation expire timeout`) and not found in
  any Microsoft Learn page returned.
- **PlayFab Lobby's own reservation/slot-hold semantics** were searched for specifically
  (ChangeLobbySlots, reserve member status) and no matching documentation was found in the
  pages indexed; PlayFab's invite model (`PFLobbySendInvite`) was found, but nothing about
  whether accepting reserves a slot versus a simple join race.
- **Tabletopia** was named in the source list as well-documented but was not searched in this
  pass; no claim about it appears above rather than guessing at its behaviour.
