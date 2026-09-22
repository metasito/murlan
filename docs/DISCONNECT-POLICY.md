# The disconnect policy, decided as a whole

**Status: decided.** #820 asked for research, options and one coherent proposal; the owner
decided on 2026-09-03. Clauses 1–11 of §6 (below) were adopted in full and are implemented —
tickets A–H of §9's original list landed as #850's disconnect policy. **Clause 12 — the
repeat-abandonment matchmaking cooldown — was rejected**, and its code (#858's
`lib/abandonCooldown.ts`, `server/matchmakingCooldown.ts`) was removed on #898. Abandoning
costs the abandoner their own score, via clause 6, and nothing further; see `docs/BRIEF.md`
§3.1 for the decision as recorded there. §5 Q7's cooldown recommendation, §7 row I and §9
item 9 below are struck for the same reason — kept, marked, rather than deleted, because the
reasoning that was rejected is itself worth keeping on the record.

Written 2026-09-02 against `origin/main` at `d5f234d`, after #815 landed.

---

## 1. What `docs/BRIEF.md` §3.1 actually says

Two rows of the §3.1 table touch abandonment. Quoted whole, because the surrounding
discussion routinely credits §3.1 with more than it decided:

> **Abandoning a hand** — **A seat abandoned mid-hand is recorded as a last-place finish.**
> The player loses rating and loses their streak. No penalty beyond that, and no achievement
> is awarded for an abandoned seat.
>
> *Rationale:* Leaving before the hand ended used to produce no record at all, which made
> closing the browser tab a complete defence against ever losing rating. A genuine network
> drop is punished identically to a rage-quit: there is no reliable signal separating them,
> and guessing would be a new class of unfairness rather than a fix.

> **Naming the winner of a single manche** — **An abandoned seat can never be announced as
> the winner.** When a `single`-length game ends and the leading seat has been vacated, the
> announced winner is the best-placed seat still held by a human. If no human seat finished,
> the manche is announced with no winner.
>
> *Rationale:* The seat keeps the departed player's name when the engine takes it over, so
> the game was crediting the person who walked out, by name, in front of the people who
> stayed. Scoring already excluded abandoned seats from the running total — this is the same
> rule applied to the announcement, which was the one place it had never been carried through.

One further row is adjacent and load-bearing:

> **Starting a new match** — … **After a match has genuinely ended, a new one needs unanimous
> ready among the connected seated humans,** not the host alone. Vacated and bot seats abstain
> rather than voting no.

**So §3.1 decides exactly three things about a player who leaves:** the hand they left is a
last-place finish that costs rating and streak; their seat can never be announced as the
winner of a single manche; and their vacated seat abstains from the rematch gate.

**§3.1 decides none of these**, though they are often attributed to it:

- how long the grace is, or what the table shows during it;
- whether the AI takes the seat over at all, or under what name;
- what happens to points the AI wins in that seat afterwards;
- what happens to points the player had already won before leaving;
- whether the seat can be reclaimed;
- what the other players are told, or may do;
- whether the *match* (as against the hand) is rated or voided;
- what the standings render.

In particular, **"scoring already excluded abandoned seats from the running total" appears
in §3.1 only as a rationale aside**, describing what the code happened to do at the time. It
is not a decision, it was never argued, and #815 showed it was not even doing what the aside
claimed — the same exclusion was silently swallowing the wins of bots that had been at the
table from the first deal.

---

## 2. What the code actually does today

The behaviour is an escalation ladder assembled from four independently-made choices.

| Stage | Trigger | What happens | Where |
|---|---|---|---|
| Turn timer | 30 s on the acting seat (`MURLAN_AFK_TIMEOUT_MS`) | The seat is made to play the **minimum legal move** — a pass, or the lowest single when a round cannot be passed. Never the AI: *"an AFK human should not be played well on their behalf."* | `server/gameTimers.ts:28`, `server/gameTurn.ts:181-205`, `lib/autoMove.ts:62-68` |
| Disconnect grace | socket lost mid-hand, 60 s (`MURLAN_DISCONNECT_GRACE_MS`) | `game:player_disconnected` broadcasts one sentence naming the seconds; the hand **continues**, the seat is still the player's, and the 30 s turn timer keeps auto-passing it. So roughly two forced minimum moves fit inside the grace. | `server/tableHandlers.ts:645-716` |
| Between hands | socket lost while `gameOver` | The shorter 20 s lobby grace, because the seat is counted in the rematch gate. | `server/gameTimers.ts:36`, `server/tableHandlers.ts:653-660` |
| Vacate | grace expired **and** the cluster says the user is offline, or an explicit `room:leave` (no grace at all) | `playerMap[seat]` deleted, `players[seat].type = "ai"`, `releasedSeats.add(userId)`, the seat recorded in `abandonedSeats` if it still held cards. The **name on the seat never changes**. Announced as `game:seat_bot_takeover`. | `server/gameTurn.ts:278-376` |
| After takeover | every turn | The real engine AI plays the seat, paced at 1.2 s a move. | `server/gameTurn.ts:137-176` |
| Rejoin | any later attempt | Refused with `SEAT_RELEASED`, permanently, for the life of that table. | `server/socketGameplay.ts:51`, `server/tableHandlers.ts:458` |

And at the hand's end (`resolveHandEnd`, `server/onlineGameLogic.ts:453+`):

- The seat's score key becomes `bot:<seat>` the moment `playerMap[seat]` is deleted.
- Since #815, `accumulates` excludes a `bot:<seat>` key **only when that seat was not a bot
  when the roster was built** — a straight-duel bot scores, a seat a human left does not.
- The abandoned seat is ordered **behind every seat that played the hand out**, so a walkout
  is genuinely last, and that placement is what `recordRatedResult` rates (`server/onlineGameLogic.ts:527-555`).
- `gameResults` for that one hand is keyed by the **departed userId**, not by `bot:<seat>` —
  which is how the last-place finish reaches their rating and history at all.

Three consequences of that arrangement are worth stating plainly, because two of them are
almost certainly not what anyone chose:

1. **The departed player's earlier points vanish from the screen.** They are still in
   `game.cumulativeScores` under the userId key — `vacateSeat` never deletes them — but the
   scoreboard row for that seat is built from `scoreKeyForSeat(playerMap, seat)`, which now
   returns `bot:<seat>`, whose total is `0`. So a player who won three manches and then
   dropped shows **0** to everyone still at the table. This is the visible half of what #815
   reported, and #815's fix did not address it.
2. **The score keys support reclaiming a seat.** `reclaimSeat` merges the `bot:<seat>`
   bucket's carried points into the returning player's own key before deleting it, so
   restoring `playerMap[seat]` restores the row, the name and the total together (#894). The
   only thing preventing a return is `releasedSeats`.
3. **The client is told about a disconnect for ten seconds and never again.** One banner via
   `setReconnectNotice`, cleared on a timer (`context/OnlineGameContext.tsx:582-592`). No
   seat carries any mark, so a player who looks up fifteen seconds later sees a table that
   appears entirely normal, with a name playing badly in it.

---

## 3. What the genre does

Named sources, with what each actually says. Where I could not find documentation for a
mechanic, that is said rather than filled in.

**Grace, and what runs during it**

- **Chess.com** ties the grace to the clock rather than to a flat number: *"you have 10% of
  the base time plus 40 times the increment, with a minimum of 30 seconds and a maximum of
  3 minutes to reconnect."* Games also end by abandonment if *"you take too long to make
  your first move"* (15 s bullet / 20 s blitz / 60 s rapid). If **both** players drop,
  *"the game ends in a draw with no rating changes."*
  ([Chess.com Help Center — How does game abandonment work?](https://support.chess.com/en/articles/8593801-how-does-game-abandonment-work))
- **Board Game Arena** runs on per-move and per-game clocks rather than a disconnect timer at
  all: a player who stops moving runs out of time and can be expelled by the others.
  ([BGA reputation announcement](https://en.boardgamearena.com/news?id=304))
- **League of Legends** requires an ally to be *"AFK or disconnected for at least 90 seconds
  before the 3 minutes mark"* before a remake vote is even offered.
  ([League of Legends Wiki — Surrendering](https://leagueoflegends.fandom.com/wiki/Surrendering);
  Riot's own [Remake FAQ](https://support.riotgames.com/league-of-legends/gameplay/remake-faq)
  exists but did not render for me, so the numbers above are the wiki's.)
- **Dota 2** converts a disconnect into an abandon after *"5 minutes of cumulative unpaused
  game time"* (3 in Turbo).
  ([Community discussion of the abandon rules](https://steamcommunity.com/app/570/discussions/0/563660559683167393/) —
  a forum, not Valve documentation; treat the exact numbers as indicative.)

**Who plays the seat while its owner is gone — and how well**

- **Japanese mahjong** is the closest analogue to this game: four seats, points per hand,
  a match made of hands, a rated ladder. Both major servers do the same thing. **Tenhou:**
  *"the game does not end. The other players can enjoy the game until completion while the
  disconnected player becomes a tsumogiri bot and suffers the rank point loss when they
  become last place."*
  ([NPMahjong on Tenhou](https://npmahjong.com/blog/tenhou-players-pro-tips))
  **Mahjong Soul** *"automates the missing player's actions, making them discard every tile
  they draw … gives the player a chance to come back while preventing the game from being
  held up for everyone else."*
  ([TV Tropes, Anti-Rage Quitting](https://tvtropes.org/pmwiki/pmwiki.php/Main/AntiRageQuitting) —
  a wiki, but it describes the mechanic precisely and I found no Yostar page that does.)
  **The important detail is that the automaton is deliberately terrible.** It plays the
  minimum legal move, exactly as this codebase's `autoMove` does for an AFK human, and the
  absent player eats the resulting last place. Neither server hands the seat to a *good* AI.
- **Catan Universe** does the opposite and replaces a dropped player with a full AI. Its own
  forums are largely complaints that the AI then stalls or trades forever; I found no
  official Catan page documenting the behaviour, only player reports.
  ([Catan Universe discussions](https://steamcommunity.com/app/544730/discussions/0/6462188749583468037/))
- **Online poker** refuses the idea outright: a disconnected player is folded or sat out,
  never played for. "Disconnect protection" — the house finishing an all-in for a dropped
  player — existed and was withdrawn across the industry because it was farmed.
  ([PokerNews glossary](https://www.pokernews.com/pokerterms/disconnect-protection.htm)
  confirms the term and that it is "all-in protection"; it does **not** document the
  withdrawal, and I could not find a first-party PokerStars page that does. Treat the
  withdrawal as unsourced.)

**What happens to the points and the rating**

- **Board Game Arena** is the most completely specified policy I found, and it is a
  multiplayer, points-scoring, rated, turn-based game — the same shape as this one:
  a player who quits or is expelled *"will lose the same ELO points as if they were the
  loser (last place) of this game, minus an additional -10 ELO"*, and *"all the other
  players will be considered tied in first place for ELO, and will receive a % of the ELO
  corresponding to the % of progression of the game at the moment the player was kicked
  out"* — 80% of the game played, 80% of the ELO.
  ([BGA forum quoting the FAQ](https://forum.boardgamearena.com/viewtopic.php?t=31867))
  BGA also allows a **mutually agreed abandonment**: if every player agrees, the game ends
  with no penalty for anyone.
  ([The Great Quitting](https://forum.boardgamearena.com/viewtopic.php?t=35402))
- **Points rummy** — the closest thing to Murlan's scoring — settles an absent seat with a
  **fixed penalty score** rather than voiding or discarding. RummyCircle: *"3 Consecutive
  Misses … considered as middle drop with 40 points loss"*, on the same scale as a voluntary
  drop (20 / 40 / 80). The player may also pre-choose their disconnect behaviour: *"you can
  choose to get dropped after 3 missed moves or you can remain on game table till you get
  reconnected."*
  ([RummyCircle rules](https://www.rummycircle.com/how-to-play-rummy/rummy-rules.html))
  Its cancellation policy voids and refunds only when *the operator* cancels a game, never
  because a player left.
  ([Cancellation policy](https://www.rummycircle.com/help/cancellation.html))
- **Lichess** refuses to distinguish a drop from a quit, in as many words: *"we cannot give
  back rating points for games lost due to lag or disconnection, regardless of whether the
  problem was at your end or our end"* — with one exception, *"when Lichess restarts and you
  lose on time because of that, we abort the game to prevent an unfair loss."* That is
  precisely §3.1's own reasoning, arrived at independently.
  ([Lichess FAQ](https://lichess.org/faq))
- **Dota 2** deliberately does *not* protect the remaining players after the opening minutes:
  a late abandon still counts as a full win or loss for everyone else, *"intentional to
  prevent players from pressuring teammates to abandon to save their own record."*
- **League of Legends** is the one clean case for voiding a match: a remake is only available
  inside the first three minutes, before anything has been earned, and *"remaking does not
  have any penalties or rewards for the players who were connected"* while *"the disconnected
  player will be penalized with a loss, a reduction in LP, and a 'Leaver' flag."*

**Repetition, not the single event**

- **Lichess:** *"If your opponent frequently aborts/leaves games, they get 'play banned' …
  If this behaviour continues, the length of the playban increases — and prolonged behaviour
  of this nature may lead to account closure."*
- **Chess.com:** *"if your account has a history of frequent disconnections, aborted games,
  or stalling, the game may instead be recorded as a loss by abandonment"* rather than an
  abort — i.e. the *same event* is judged differently depending on your record.
- **Board Game Arena:** karma. New players start at 75☯, *"each game played to the end gives
  you +1☯"*, and *"each time you leave a game in progress you lose 10☯ (or 20☯ if you are a
  recidivist)"*, with the first offence forgiven. The score is public, so opponents can
  decline a game with a known quitter.

**Where the good ones differ from the mediocre ones.** Three patterns separate them:

1. **The good ones never let an absent seat be played *well*.** Mahjong's tsumogiri bot,
   poker's auto-fold and this codebase's own minimum-legal move are the same design decision;
   Catan Universe's full AI takeover is the one that generates complaints.
2. **The good ones keep the arithmetic honest.** Nobody discards a hand's points. BGA hands
   the quitter a last place and pays the survivors pro rata; rummy hands the absent seat a
   fixed penalty score. The books always balance.
3. **The good ones escalate on the record, not on the incident.** One drop is treated
   charitably and cheaply everywhere. Repetition is where the real penalty lives — and it is
   almost always a matchmaking or reputation penalty rather than a bigger rating hit.

---

## 4. Five principles

These are what make the eight answers one policy instead of eight. Every recommendation below
is derived from them, and where two principles pull against each other the tie is broken in
this order.

1. **One identity, one ledger.** A point belongs to the person who won it. A disconnect
   destroys no points and creates none, and the standings always sum to the hands played.
2. **Absence is never profitable.** Every outcome of leaving must be weakly worse for the
   leaver than staying, whether they are ahead or behind. This is the anti-cheat principle
   and it outranks convenience.
3. **The people who stayed are held harmless.** They keep what they earned, they are never
   trapped in a match that has stopped being the one they joined, and they are never made to
   pay for someone else's connection.
4. **A drop and a rage-quit are not distinguished** (§3.1, and Lichess). Therefore the
   penalty for one incident is bounded and forgiving, and escalation lives on the record.
5. **An absent seat is played badly, visibly, and never for keeps.** The table must not stall
   (BRIEF W3), but the substitute must not be an upgrade, and nobody may mistake it for the
   person.

---

## 5. The eight questions

### Q1 — A player disconnects mid-hand: how long, what is shown, does the hand pause?

| Option | Consequence | Exploit it opens |
|---|---|---|
| **Pause the hand** for the grace | Fairest to the dropped player | **The hostage exploit.** Anyone losing a manche pulls their network and freezes three other people for a minute. Every source rejects pausing for this reason. |
| **Continue, auto-pass** (today, 30 s a turn inside a 60 s grace) | Table never stalls; the absent seat plays badly, which is correct | Very small: the absent seat can still be *forced* to open a round with its lowest card, which leaks information. Same leak an AFK human already has. |
| Continue, **AI plays immediately** | Strongest play continuity | **The upgrade exploit.** If the AI plays better than you, dropping is a move. Catan Universe's failure mode. |
| Longer grace (3-5 min) | Kinder to mobile networks | The other three wait; and the longer the window, the more the frozen seat's forced minimum moves distort the hand anyway. |

**Recommend: keep the shape, fix the display.** 60 s grace, hand continues, minimum legal
move only. Chess.com's scaling (10% of base time, floor 30 s, ceiling 3 min) is the better
idea in principle, but this game has no per-match clock to scale from, so a flat 60 s
between a 30 s turn timer and a 20 s lobby grace is already the right order of magnitude.

The change is what the table is told. Today: one 10-second banner. Recommended: **the seat
itself carries the state for as long as it lasts** — the avatar dimmed, a countdown, and the
seat marked as reconnecting. The server already emits `seconds` in `params` and already has
the `game:turn_deadline` precedent for a live countdown, so this is client work over an
existing payload.

### Q2 — The AI takes over: when, announced how, and under what name?

| Option | Consequence | Exploit it opens |
|---|---|---|
| **Never** — hand ends, seat forfeits | Simplest ledger | In a 3-4 seat match, one person's phone ends everyone's match. Violates P3. |
| **Immediately on disconnect** | No dead turns at all | The upgrade exploit again, and it punishes a 5-second mobile hiccup as hard as a walkout. |
| **After the grace** (today) | Table survives, absence is cheap for everyone else | None, *provided the seat is not an upgrade* — see below. |
| Seat keeps the player's name (today) | No work | **Reputational forgery, and it is live today.** The name of someone who left plays badly, or brilliantly, in front of people who think it is them. §3.1 already had to write a special rule to stop the announcement crediting a walkout by name; the seat itself was never fixed. |
| Seat renamed to a bot name | Honest | The departed player's contribution to the match becomes unattributable, and §3.1's abandonment record loses its on-screen anchor. |
| **Seat reads as "Drita — left"** | Honest and attributable | None found. |

**Recommend: takeover after the grace, as today; announcement as today; and the seat is
labelled as vacated.**

**On the display constraint.** `CLAUDE.md` is right that a winner must be an engine player id
and that `bot:<seat>` is a key no client can name — but that constraint bites the *key space*,
not the seat. Every scoreboard row already carries `seatIndex`, `engineId`, `userId` and
`username` (`lib/matchState.ts:131-139`), and the seat's own `name` survives `vacateSeat`
untouched. So the buildable form of the label is:

- **do not** send a rendered string like `"Drita (left)"` — the server renders in
  `DEFAULT_LOCALE` and rule 19 requires `t()`;
- **do** add a `vacated: boolean` to the sanitized player and to `ScoreLine`, keep `name` as
  the person's real name, and let each client render `t("game.seatLeft", { username })` in
  its own locale.

That is one server flag, one locale key in three files, and two render sites. Nothing has to
reverse a `bot:<seat>` key back to a human.

**On how well the AI plays it.** This is the one place the recommendation contradicts current
behaviour on purpose. Today `handleAutoPass` uses `useAi: false` for a seat still held and
`runBotTurn` uses `useAi: true` once it is vacated — so crossing the grace boundary *upgrades*
the seat from a minimum-legal-move player to the full engine AI. Every well-regarded
implementation in §3 does the opposite or refuses the seat entirely. **Recommend the takeover
AI stays weak** — the same minimum legal move — until the hand in progress ends, and only
plays properly from the next deal, by which point the seat is honestly a bot seat and its
points are honestly the bot's (Q3). This costs one boolean at one call site and removes the
entire class of "my opponent left and then started playing better" complaint.

### Q3 — Points the AI wins in that seat

| Option | Consequence | Exploit it opens |
|---|---|---|
| **Discard them** (today) | The leaver gains nothing | **The spoiler exploit, and an arithmetic hole.** Every manche the bot wins is a manche whose points leave the game: the survivors' race to the target lengthens, and the standings stop summing to the hands played — with nothing on screen to say why. That is exactly the shape of #815, which was one instance of it. It also *rewards quitting when behind*: your seat becomes a permanent spoiler that can take points away from the leader without giving them to anyone. |
| **Credit the absent player** | Standings sum | **Rewards quitting while ahead**, and lets a decent AI farm rating and match wins for someone who is asleep. Squarely against P2. Poker's withdrawn disconnect protection is this option's history. |
| **Credit a visibly non-human seat** | Standings sum, leaver gains nothing, the row explains itself | None found. It is also *already* what the code does for a bot that was dealt in from the start, since #815. |
| **Void the match** | Nobody is cheated | **The escape hatch.** Losing a match becomes a reason to disconnect. Dota 2 refuses exactly this, for exactly this reason. |

**Recommend: the seat keeps scoring, under the bot identity, from the moment of takeover.**
The strongest argument is consistency rather than novelty: after #815, a seat that was a bot
from the first deal scores normally and can be an opponent worth beating. **A seat that
becomes a bot mid-match should behave exactly like one that was a bot from the start.** The
special case is what generated the hole, and the special case is not needed — the existing
pin (`tests/scoring.test.ts:320`, "a vacated seat cannot cross the target or be named the
winner") is what stops a bot from winning a match, and it stays.

The single narrow exception worth keeping from the void option is LoL's: **a match abandoned
before any point has been scored — the first manche, nothing on the board — is voided for
everyone and rated for nobody.** Nothing has been earned, so nothing is taken away, and there
is no escape hatch because there is nothing to escape from yet.

### Q4 — Points the player already won before leaving

| Option | Consequence | Exploit |
|---|---|---|
| **Lost with the seat** (today, on screen) | Punishes leaving | Punishes it *retroactively and invisibly*, which reads as a bug — it is what the owner reported in #815. It also punishes a dropped connection by deleting an hour of play. |
| **Kept and shown** | Honest ledger, P1 | None: they are frozen, and the seat can never cross the target, so they buy nothing. |

**Recommend: kept, shown, and frozen.** They already survive in `cumulativeScores` under the
userId key; nothing needs to be stored, only rendered. Combined with Q3, a vacated seat's row
carries a total that is *the person's frozen points plus the bot's points since takeover*,
with the seat labelled as vacated — one row per seat, and the board sums to the hands played
again.

### Q5 — Coming back

| Option | Consequence | Exploit |
|---|---|---|
| **Never** (today) | Simple; the seat is settled once | Punishes a tunnel or a lift. A 61-second outage ends a 40-minute match for a paying-attention player, and there is no recourse. |
| **Longer grace only** | Cheap | Moves the cliff without removing it. |
| **Seat reclaimable for the rest of the match** | The kind thing, and nearly free here | **The rough-hand exploit** — leave when your cards are bad, let the bot eat the last place, come back for the next deal. Neutralised by the rules above: the abandonment is already recorded against the hand you left (§3.1), and the points the bot earned in the meantime belong to the bot, not to you. There is nothing to farm. |
| Reclaimable by anyone | Fills seats | Identity theft of a scoreboard row. Never. |

**Recommend: reclaimable, by the same account, into the same seat, for as long as the match
is live.** `SEAT_RELEASED` stops being permanent and becomes the answer for a *finished or
disposed* table only. This is the cheapest of the recommendations to build and the largest in
player-facing effect: `reclaimSeat` merges the `bot:<seat>` bucket into the userId key before
restoring `playerMap[seat]`, so the row, the name and the total are restored together
(§2, note 2; #894).

Two guards it must keep: the AFK window is **not** re-armed on a rejoin (already the rule —
`clearDisconnectGrace`'s comment; re-arming lets a client loop hold a table open forever), and
the return is announced as clearly as the departure was.

### Q6 — The other players

| Option | Consequence | Exploit |
|---|---|---|
| Told once, briefly (today) | No work | Fifteen seconds later the table looks normal and a stranger is playing under a familiar name. |
| **Told persistently, on the seat** | Everyone can see what they are playing against | None. |
| Let them vote to **kick** a slow player | Fast tables | Three players can eject the one who is winning. Never, in a rated game. |
| **Let them leave without penalty** once a seat is vacated | Nobody is trapped | **The collusion exploit.** Two accounts: one abandons deliberately so the other escapes a losing match for free. This is precisely why Dota 2 keeps the loss on the survivors. |
| **Unanimous vote to end the match, no penalty** | Nobody is trapped, and nobody can be forced | Collusion needs *everyone*, including the players it would hurt — which is not collusion, it is consent. BGA's mutual-abandonment rule. |

**Recommend: told persistently; nothing to vote about while the match is playable; and once a
seat has been vacated mid-match, any remaining player may call a vote to end the match, which
carries only if every connected seated human agrees — in which case the match ends with no
abandonment penalty for anyone still present.** This reuses the unanimity gate §3.1 already
chose for starting a new match, including its "vacated and bot seats abstain" rule, so it is
one more caller of machinery that exists rather than a new mechanism.

### Q7 — Rating

| Option | Consequence | Exploit |
|---|---|---|
| Abandoned hand rates as last place (today, §3.1) | Quitting costs what losing costs | It costs *exactly* what losing costs, so quitting a hand you were losing anyway is free. BGA's answer to this is the extra −10. |
| Nothing counts for anyone | Nobody is cheated by someone else's router | Every rated loss becomes escapable. The single worst option, and the one every source rejects. |
| Survivors keep their rating for the hands they played (today) | Correct by P3 | None. |
| ~~Add an escalating penalty on the record~~ **Rejected on #898** | Repeat quitters are handled where the problem actually is | Needs storage, and a false positive punishes someone's commute. Keep it a matchmaking cooldown, never a bigger rating hit. |

~~**Recommend: keep §3.1's rule unchanged, add nothing to the single incident, and put the
escalation on the record.** Every source that has solved this solved it this way (Lichess
playbans, chess.com's history-dependent verdict, BGA karma). The mechanic to build is the
smallest one that works: count abandonments per account over a rolling window and impose a
short matchmaking cooldown past a threshold, with the first offence forgiven.~~

**Decided against, 2026-09-03 (#898): no cooldown, at any threshold.** Abandoning costs the
abandoner their own score — Q4's frozen-points clause — and nothing further; one drop, or a
habit of them, is forgiven.

The honest cost note that made this the safely-deferred item is now moot: `match_history` did
gain the `abandoned` column (`shared/schema.ts`, written by `server/stats.ts`) — it feeds
`GET /api/stats/history`'s own record of a hand, which #898 keeps — but no rolling count and
no gate was ever built on it, and none will be.

### Q8 — What the standings should show

The premise of the question — "the totals legitimately no longer sum to the hands played" —
**stops being true if Q3 and Q4 are accepted.** That is the main reason to accept them: the
alternative is building a persistent explanation for an anomaly that does not need to exist.

**Recommend: one row per seat, always; totals always sum to the hands played; a vacated seat's
row carries the person's name marked as departed, and a total that is their frozen points plus
the bot's points since takeover.** The winner is still stated as an engine player id, exactly
as `CLAUDE.md` requires, and no client ever has to name `bot:<seat>` — the row it renders
carries `seatIndex`, `engineId` and `username` already.

If the owner instead keeps today's discard rule (Q3), then the standings **must** carry a
persistent, translated explanation — a line under the board saying how many points left the
match with a departed seat — because a scoreboard that silently fails to add up is the defect
#815 was filed as, not a display preference.

---

## 6. The recommended policy, in one page

1. **30 s a turn**, unchanged: the seat plays the minimum legal move, never well.
2. **60 s disconnect grace**, unchanged in length. The hand continues. The *seat* shows the
   countdown for the whole window, not a banner for ten seconds of it.
3. **After the grace the seat is vacated and labelled as vacated** — the person's name, marked
   as departed, rendered by each client in its own locale from a `vacated` flag.
4. **The takeover plays the current hand out at minimum legal strength**, and only plays
   properly from the next deal.
5. **The seat keeps scoring after takeover, as a bot seat** — exactly as a seat that was a bot
   from the first deal does. It can never cross the target and can never be named the winner.
6. **Points won before leaving are kept, shown and frozen.**
7. **The standings always sum to the hands played.** No explanatory footnote is needed, because
   there is no longer an anomaly to explain.
8. **The seat is reclaimable by the same account for the life of the match.** `SEAT_RELEASED`
   answers only for a table that is finished or gone.
9. **The abandonment already recorded stands** — last place, rating, streak (§3.1 unchanged) —
   and returning does not undo it.
10. **Once a seat has been vacated mid-match, any remaining player may call a unanimous vote to
    end the match**, penalty-free for everyone still present.
11. **A match abandoned before a single point is scored is voided and rated for nobody.**
12. ~~Repetition escalates, on the record, as a matchmaking cooldown — never as a larger
    rating loss, and never on the first offence.~~ **Rejected, 2026-09-03 (#898): no cooldown.**
    The record stands (9); nothing further is enforced on it.

Read against the principles: nothing rewards leaving whether you are ahead (5, 9) or behind
(5, 11's narrow window); nobody is trapped (10) or robbed (6, 8); the table never stalls (1-4);
the substitute is never an upgrade (1, 4); and one drop, or several, is forgiven (9).

---

## 7. What this changes, and what each change costs

Sizes are the ticket scale used in the tracker.

| # | Change | From → to | Cost | Risk |
|---|---|---|---|---|
| A | Seat shows the reconnect state for the whole grace | 10 s banner → persistent seat state + countdown | **S**, client only; server already sends `seconds`, `game:turn_deadline` is the precedent | Low |
| B | Vacated seat is labelled as vacated | name unchanged → `vacated` flag on the sanitized player and `ScoreLine`, `t()` in three locales | **S** | Low; touches the sanitizer and two render sites |
| C | Takeover plays the current hand at minimum strength | `useAi: true` at takeover → `false` until the hand ends | **S**, one boolean at `server/gameTurn.ts:137-176` | Low; needs a test that the seat still always resolves |
| D | Vacated seat scores as a bot seat | `accumulates` excludes it → excludes nothing | **S** in code (delete the exception added by #815's `botSeatsAtStart` for the vacate case), **M** in tests: `tests/scoring.test.ts:292-360` is written around the opposite rule and its intent has to be re-pinned, not just re-baselined | Medium — this is the row of §3.1's rationale that everyone has been reading as a decision |
| E | Frozen pre-departure points are shown | seat row reads `bot:<seat>` total → row sums the person's frozen total and the seat's bot total | **S**, inside `resolveHandEnd`'s `detailed` builder | Low |
| F | Seat reclaimable for the life of the match | `releasedSeats` permanent → consulted only for a finished/disposed table | **M**; the rejoin path, the announcement both ways, and the AFK-rearm guard | Medium — this is the reconnection mechanics #820 explicitly deferred, so it is the one that most needs its own design pass |
| G | Unanimous end-the-match vote after a vacancy | none → new vote, reusing the rematch gate's unanimity and abstention rules | **M**, server + one screen + locale keys | Medium |
| H | Void a match abandoned before the first point | none → new branch at hand end | **S** | Low |
| I | ~~Repeat-abandonment cooldown~~ | ~~none → new `abandoned` column on `match_history`, a rolling count, a matchmaking gate~~ | ~~**L**, and design-first: real accounts, `pg_dump` first~~ | **Rejected, 2026-09-03 (#898).** The `abandoned` column was built (it serves `GET /api/stats/history`), but no count and no gate. |

**Unchanged by this recommendation:** the 30 s turn timer; the 60 s and 20 s grace lengths;
§3.1's abandonment rule; the winner being stated as an engine player id; the rule that a
vacated seat cannot cross the target or be announced as a winner; the rematch abstention rule.

---

## 8. If the owner disagrees with the core of it

The one decision everything else hangs on is **Q3** — whether a vacated seat keeps scoring. If
that is rejected and today's discard rule is kept, then D, E and most of Q8's simplicity go,
and in their place the standings need a persistent, translated explanation of why the numbers
do not add up (an **M** of its own, and a permanent piece of UI explaining an internal rule to
players). A, B, C, F and G are independent of Q3 and stand either way.

---

## 9. Tickets this would produce

Filed only after the owner decides; titles and one-line scopes, in the order they should be
worked.

1. **Show the disconnect on the seat, for as long as it lasts** — replace the 10-second banner
   with a persistent seat state and countdown driven by the existing `params.seconds`. (A)
2. **Mark a vacated seat as vacated, in the player's own language** — a `vacated` flag on the
   sanitized player and `ScoreLine`, rendered via `t()` in all three locales. (B)
3. **A taken-over seat finishes the hand at minimum legal strength** — the engine AI starts at
   the next deal, not at the moment of takeover. (C)
4. **A seat that becomes a bot scores like a seat that was born one** — remove the vacate
   exception from `accumulates`, and re-pin `tests/scoring.test.ts` on the new rule. (D)
5. **Show the points a departed player had already won** — the seat's row sums their frozen
   total and the bot's points since takeover. (E)
6. **Let a player reclaim their seat for the life of the match** — `SEAT_RELEASED` answers only
   for a finished or disposed table; announce the return as loudly as the departure. (F)
7. **A unanimous vote to end a match a seat has been vacated from** — reusing the rematch gate's
   unanimity and abstention rules, penalty-free for everyone present. (G)
8. **Void a match abandoned before its first point** — nothing earned, nothing taken, rated for
   nobody. (H)
9. ~~Record abandonments and cool down repeat quitters~~ — **rejected, 2026-09-03 (#898); no
   cooldown, at any threshold.** (I)

---

## 10. Sources

- [Chess.com Help Center — How does game abandonment work?](https://support.chess.com/en/articles/8593801-how-does-game-abandonment-work)
- [Lichess FAQ](https://lichess.org/faq)
- [Board Game Arena — Introducing: new reputation system and Karma](https://en.boardgamearena.com/news?id=304)
- [Board Game Arena forum — ELO in games that end because someone leaves or gets kicked out](https://forum.boardgamearena.com/viewtopic.php?t=31867)
- [Board Game Arena forum — The Great Quitting](https://forum.boardgamearena.com/viewtopic.php?t=35402)
- [RummyCircle — Rummy rules](https://www.rummycircle.com/how-to-play-rummy/rummy-rules.html)
- [RummyCircle — Games cancellation settlement policy](https://www.rummycircle.com/help/cancellation.html)
- [NPMahjong — Tenhou: a warning for new players](https://npmahjong.com/blog/tenhou-players-pro-tips)
- [TV Tropes — Anti-Rage Quitting (Mahjong Soul's automaton)](https://tvtropes.org/pmwiki/pmwiki.php/Main/AntiRageQuitting)
- [League of Legends Wiki — Surrendering (Remake)](https://leagueoflegends.fandom.com/wiki/Surrendering)
- [Riot Games Support — Remake FAQ](https://support.riotgames.com/league-of-legends/gameplay/remake-faq)
- [Steam community — Dota 2 abandon rules](https://steamcommunity.com/app/570/discussions/0/563660559683167393/)
- [Steam community — Catan Universe, AI replacing a dropped player](https://steamcommunity.com/app/544730/discussions/0/6462188749583468037/)
- [PokerNews glossary — Disconnect protection](https://www.pokernews.com/pokerterms/disconnect-protection.htm)

**Claims I could not source, and am not asserting:** that online poker rooms withdrew
disconnect protection because it was abused (widely repeated, no first-party page found); the
exact reconnect window Hearthstone allows (Blizzard publishes troubleshooting, not a policy
page — every number I found was a player report); and any documented disconnect policy for the
two existing Murlan apps, whose store listings and site say nothing about it. One App Store
review of a competitor reports being given "a leaving penalty despite the disconnection
message", which is a user's account of a bug rather than a statement of policy, and is quoted
here only as evidence that players notice and mind.
