# Pending friend requests — how other clients present them, and what this screen should do

Research date: 2026-08-28. Subject: `app/(online)/friends.tsx`, and the request badge on
`app/index.tsx`. Written for #540. Nothing here is implemented; this is a decision document
and the evidence behind it.

The owner's words, which set the question:

> "doesn't show the request as a separate submenu named 'pending' or sth like that and
> keeping all the pending requests there: those which you sent and people sent to you.
> or maybe pending approval / pending request to differ them. idk do a research."

Two readings of the same screen are on the table, and they are not compatible:
**one bucket that holds everything unfinished**, or **two buckets split by who has to act**.
The rest of this document is about which, and why.

---

## 1. The current state, recorded verbatim

### 1.1 What the screen renders, top to bottom

`app/(online)/friends.tsx` is one scrolling column inside `MenuLayout`. Every section is a
`SectionHeader` (uppercase label + optional count badge) followed by a `listBlock` of rows.
Recorded from source rather than from memory:

| # | Section | Header key | Gate | Count badge | Row actions |
|---|---------|-----------|------|-------------|-------------|
| 1 | Friends | `friends.sectionFriends` | **always renders** | `friends.length` when > 0 | remove |
| 2 | Game invites | `friends.sectionGameInvites` | `gameInvites.length > 0` | `gameInvites.length` | dismiss, join |
| 3 | Received requests | `friends.sectionReceivedRequests` | `requests.length > 0` | `requests.length` | decline, accept |
| 4 | Sent requests | `friends.sectionSentRequests` | `sentRequests.length > 0` | `sentRequests.length` | cancel |
| 5 | Add friend | `friends.sectionAddFriend` | **always renders** | none | search, send |

Section 1 is the only one with a real empty state: an outline `people` glyph and
`friends.emptyFriends` ("No friends yet.\nSearch for a username!"). It also has a load-error
state with a retry button. **Sections 2, 3 and 4 have neither.** When the lists are empty
they render literally nothing — not a header, not a hint, not a gap.

Note the two source comments still read `SECTION 3` for both 3 and 4; the numbering in the
file drifted at some point and section 4 is labelled `SECTION 3: Richieste Inviate`.

### 1.2 The consequence, which is the whole bug

A first-time user sees exactly two headers: FRIENDS and ADD FRIEND. They send a request. A
`friend_request` toast fires (`friends.requestSentTitle` / `requestSentBody`), the
`/api/friends/sent` query is invalidated, and a SENT REQUESTS section appears — *below the
fold*, under the friends list, above the search card they are still looking at. If the
recipient then accepts, the section vanishes again.

So the pending state has no fixed location. It appears and disappears under the user, and it
is never there when they go looking for it before they have one. The owner did not miss a
feature; the screen genuinely never told them where pending things live.

### 1.3 The data and the actions are all complete

Nothing in this ticket needs a new endpoint. Verified in `server/routes.ts`:

- `GET /api/friends/requests` (line 457) — incoming.
- `GET /api/friends/sent` (line 479) — outgoing.
- `POST /api/friends/add` (487), behind `friendLimiter`.
- `DELETE /api/friends/requests/:id` (531) — cancel your own.
- `POST /api/friends/accept/:id` (543), `POST /api/friends/decline/:id` (571).

Both directions are queried on the client with `refetchOnWindowFocus: true`, and since #541
both are re-read on socket connect (`RECONCILED_ON_CONNECT` in `context/SocketContext.tsx`),
so a request sent while the recipient was offline is no longer lost. That bug is closed; this
screen can now be judged on its own.

### 1.4 The badge on home already counts the right thing

`useFriendRequestCount()` in `app/index.tsx` (line 405) reads `/api/friends/requests` only —
incoming. Outgoing requests never reach the home badge. **The entry point is already correct**,
and any proposal here must not break that. The problem is one layer in: inside the screen,
`SENT REQUESTS` carries a count badge with the identical treatment to `RECEIVED REQUESTS`, so
two things that demand very different amounts of the user read as the same kind of number.

---

## 2. How established clients solve it

### 2.1 Discord — one "Pending" tab, two labelled groups inside it

Discord's friends surface is a row of tabs: Online, All, **Pending**, Blocked, Add Friend. The
Pending tab is a staging area for anything not yet finalised, and inside it the list is split
into two labelled groups, **INCOMING** first and **OUTGOING** beneath it. Incoming rows carry
Accept and Ignore; outgoing rows carry a cancel affordance only.
([iorad walkthrough](https://www.iorad.com/player/2049382/Discord---How-to-view-your-pending-incoming-and-outgoing-friend-request),
[Discord support](https://support.discord.com/hc/en-us/articles/218344397-How-do-I-add-friends-on-Discord),
[discordlabs FAQ](https://discordlabs.org/faqs/how-to-check-friend-requests-on-discord))

The tab is present whether or not it has contents — that is what makes it a place. The badge
on the tab counts incoming only.
([Discord badge thread](https://support.discord.com/hc/en-us/community/posts/360043000731-Friend-Request-Notification-Badges))

This is the shape the owner described almost exactly: one named bucket, two directions told
apart inside it.

### 2.2 Chess.com — a persistent Friend Requests panel with an Outgoing tab

Chess.com puts a Friend Requests panel on the Friends page and splits it with an **Outgoing**
tab; cancelling is an X on the row. Notably it enforces a **limit of 10 pending outgoing
requests** — hit it and you cannot send another until you cancel some, which makes the
outgoing list something you must actually be able to find.
([cancel a sent request](https://support.chess.com/en/articles/8639444-how-do-i-cancel-a-friend-request-i-sent),
[accept or decline](https://support.chess.com/en/articles/8712561-how-do-i-accept-or-decline-a-friend-request),
[forum: viewing pending](https://www.chess.com/forum/view/community/how-to-view-pending-friend-requests))

On mobile the incoming requests live behind a bell, separate from the people icon — a split
worth noting as the thing *not* to copy: several of the forum threads above exist precisely
because users could not find where their sent requests went.

### 2.3 Steam — outgoing exists but is famously hard to find

Steam keeps pending outgoing invites at the **bottom of the friends window, below the fold**,
and users routinely ask where they are.
([forum: seeing sent requests](https://steamcommunity.com/discussions/forum/30/215439774850779308))
Steam requests **do not expire**, but sending is rate-limited — on the order of 30 per week,
with a cooldown of a week to a month once you trip it.
([cooldown](https://steamcommunity.com/discussions/forum/0/2974027084082001526/),
[re-sending](https://steamcommunity.com/discussions/forum/0/2952595757891984835/),
[how long they last](https://steamcommunity.com/discussions/forum/1/2996547001734958205/))

Steam is the negative example. It is the same layout this app has today — outgoing requests
appended to the end of a long column — and it generates the same confusion.

### 2.4 Facebook — one "Sent requests" view, reachable while empty

Facebook keeps sent requests on a dedicated view under Friend Requests → View sent requests,
which exists whether or not it has contents.
([contentstudio](https://contentstudio.io/blog/how-to-see-sent-friend-requests-on-facebook),
[qqtube](https://www.qqtube.com/blog/how-to-see-sent-friend-requests-on-facebook))

### 2.5 What no client publishes

None of the four publish design guidance on badge arithmetic. Every one of them nonetheless
*behaves* the same way — the badge counts incoming — and the reason is legible without a
document: a badge is a task counter, and a request you sent is not a task you owe.

---

## 3. The four questions the ticket asked, answered

**One bucket or two?** Both, layered. Every client that solves this well uses **one named
place** (a tab, a panel) containing **two labelled groups**. One bucket alone loses the
distinction between "act on this" and "wait for this"; two peer sections lose the place. The
owner's two candidate namings are not alternatives — they are the outer and inner layer.

**Where does the count go, and does outgoing count?** Incoming only, everywhere.
`useFriendRequestCount()` already does this on home; the in-screen SENT badge should stop
looking like a task counter. It can carry its number in a quieter treatment, or carry none.

**What does the empty state say?** It is the only thing most users ever see, so it is the
main deliverable, not a fallback. It has to name the place ("nothing is waiting") and point
at the next action (the search box directly below).

**Anything beyond cancel on an outgoing row?** Resending is worthless here: the request is
already stored server-side and #541 made sure it is re-read on connect, so a resend would
change nothing the recipient sees. Nothing in this app expires a request, and no researched
client expires one either (Steam explicitly does not). What an outgoing row *should* gain is
**how long it has been waiting** — the same `relativeTime()` the friends list already uses —
because that is the information that tells a user whether to cancel. It costs one field on
the endpoint and it is honest.

---

## 4. Three layouts for the owner to compare

All three keep the two-layer answer from §3 and differ in how loud the outer layer is.
Mockups go through `/design`; this section is the specification behind them.

### Option A — "One PENDING section, two labelled groups"

The smallest change that is a real fix. Sections 3 and 4 collapse into one `PENDING` section
that **always renders**. Inside it, two sub-labels — waiting for you / waiting for them —
each with its rows. Empty: one line under the header saying nothing is waiting, with the
search card immediately below as the next action.

- Badge on the section header counts incoming only.
- Outgoing rows keep cancel, and gain "sent {time} ago".
- Cost: one screen, no navigation change. Does not touch #343 or #398.

### Option B — "Two sections that always render"

Keep `RECEIVED REQUESTS` and `SENT REQUESTS` as they are, but render both unconditionally,
each with its own empty line. Closest to today's code and to the owner's "pending approval /
pending request" reading.

- Cost: cheapest of the three. Risk: two permanently-visible empty headers on a screen that
  is empty for most new users — the screen gains structure but also gains noise.

### Option C — "A Pending row that opens its own screen"

A single row in the friends screen — "Pending · 2" — routing to `(online)/pending`, which holds
both groups. Mirrors Discord's tab most closely and scales if requests ever become numerous.

- Cost: a new route, which puts it in the same navigation decision as #343, and a second
  place for the badge to be right or wrong. Overkill at the scale this app is at, but the
  right answer if pending ever grows a third kind of item.

**Recommendation: A.** It is the shape every client converged on, it fixes discoverability in
one screen, and it does not spend a route on a list that will usually hold zero or one item.
B is A minus the grouping and plus the noise; C is A plus a navigation decision that #343
should make first.

---

## 5. What ships regardless of the pick

Independent of which option the owner chooses, and not a matter of taste:

- The pending state is legible when empty. Today it renders nothing at all.
- Outgoing stops carrying a task-counter badge identical to incoming's.
- Outgoing rows say how long they have been waiting, so cancelling is an informed choice.
- Every state has a next action; `friends.awaitingResponse` plus a cancel control already
  satisfies this for outgoing, and accept/decline does for incoming. The gap is only the
  empty state, which currently offers nothing because it does not exist.
