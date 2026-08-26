# How real games build a main menu — evidence for the home-screen redesign

Research date: 2026-08-26. Follow-up to `docs/research/2026-08-26-menu-reorganisation.md`,
which is assumed read: the current state of `app/index.tsx`, the three proposals, the
a11y defects and the general UX citations are there and are not repeated here.

This document answers five things the owner asked after rejecting two elements of that
round. It is evidence, not a decision.

**How to read the citations.** Every external claim carries a URL that was actually
fetched. Where the claim rests on a page whose body could not be retrieved, or on a
third-party guide rather than the vendor, it is either marked inline or moved to §6.
Nothing here describes a screenshot that was not actually looked at or documented in text.

---

## 1. The subtext question

> *"I don't like undertext like '3 waiting', 'Sound, language', 'Where you rank'. I don't
> think any game has such thing."*

### 1.1 Verdict

**Refuted as an absolute, and confirmed for two of the three examples he named.** The
claim splits cleanly in three, because the three examples he chose are three different
kinds of second line:

| His example | What kind of line it is | Verdict |
|---|---|---|
| "Where you rank" (under Leaderboard) | static explanation of a **utility** entry | **He is right.** No verified example. |
| "Sound, language" (under Settings) | static explanation of a **settings** entry | **He is right.** No verified example, and Apple argues against it. |
| "3 waiting" (under Play with friends) | a **live count**, not an explanation | **He is wrong about the information, right about the form.** Games show this constantly — as a badge or a parenthesised number, never as a sentence on a second line. |

And the general claim — *no game has such a thing* — is false. The nearest large
competitor in the genre does it on **every single play-mode row**.

### 1.2 The refutation: chess.com's Play menu

`https://www.chess.com/play`, fetched and read on 2026-08-26 (page text extracted from
the live DOM, logged out). The right-hand panel is titled **"Play Chess"** and is a
vertical list of six rows. Every row is icon + bold label + a smaller grey second line:

```
Play Online        Play vs a person of similar skill
Play Bots          Challenge a bot from Easy to Master
Play Coach         Learn as you play a game with Coach
Play a Friend      Invite a friend to a game of chess
Tournaments        Join an Arena where anyone can win
Chess Variants     Find fun new ways to play chess
```

Source: <https://www.chess.com/play> (strings above are the page's own text, verbatim).

This is not a settings screen and not an onboarding flow. It is the primary
mode-selection surface of the largest chess site in the world, it is structurally the
same object as `menuButtons()` in `app/index.tsx` — a stack of tappable rows, one per
mode — and it carries a descriptive second line on all six.

Two further things worth taking from that same screen, because they answer §1 and §2
at once:

- **The utility entries below the panel carry no second line.** Under the six rows sit
  two small icon links, `Game History` and `Leaderboard`, bare, no description. So even
  the site that describes every play mode does *not* describe its leaderboard. The
  owner's instinct about "Where you rank" matches what chess.com actually does.
- **The account cluster is not in the list.** The left rail runs `Play / Puzzles /
  Learn / Train / Watch / Community / Other` and then, pinned to the bottom of the rail:
  `Search`, `Sign Up`, `Log In`, `Help & Support`, `English`. See §2.

chess.com's own help page describes the intent behind the arrangement: **"the most
popular features are conveniently located at the top of your home screen"** and
"Simply choose the one that fits what you're looking for!"
(<https://support.chess.com/en/articles/8615318-welcome-to-chess-com>).

### 1.3 The other side: menus that carry no second line at all

- **Lichess web home.** The three primary calls to action are `Create lobby game`,
  `Challenge a friend`, `Play against computer` — labels only, no descriptions. The
  page's own HTML was fetched and grepped; the strings appear bare.
  <https://lichess.org/>
- **Lichess mobile, home tab.** The home screen is assembled from widgets
  (`_EditableWidget`) — a greeting, performance cards, a followed-players carousel, the
  quick-game matrix, ongoing games, featured tournaments, blog, recent games. It renders
  **no `ListTile` with a `subtitle`** for any navigation entry. Verified against source:
  <https://raw.githubusercontent.com/lichess-org/mobile/main/lib/src/view/home/home_tab_screen.dart>
- **PlayOK**, a 28-game online board/card portal in exactly Murlan's class. Every game
  is `name (count)` and nothing else — `chess (1590)`, `hearts (502)`, `canasta (824)`,
  `durak (82)`, `spades (416)` — plus one global line, `16473 players online`. No
  descriptions anywhere. <https://www.playok.com/en/>
- **Hearthstone's main menu.** The wiki's account of the screen lists eight buttons —
  Hearthstone, Battlegrounds, Arena, Modes, My Collection, Open Packs, Journal, Shop —
  and the only secondary information on any of them is a number: *"the number beneath
  the Open Packs icon can be checked from the main menu to see the number of unopened
  packs currently awaiting the player's attention."* No explanatory lines.
  <https://hearthstone.wiki.gg/wiki/Main_menu>

### 1.4 The third category: a second line that carries a *value*

This is where "3 waiting" actually belongs, and it is a real and common convention — but
the form is a count, not a sentence.

- **Lichess mobile's quick-pairing tiles** are the clearest case. Each tile is
  `title` = the time control (`3+0`) and `subtitle` = the speed class (`Blitz`). A second
  line, but it is a classifying value, not an explanation of what the button does:
  ```dart
  title: Text(choice.display, style: ... fontSize: 20.0),
  subtitle: Text(choice.speed.label(context.l10n), style: ... fontSize: 14.0),
  ```
  <https://raw.githubusercontent.com/lichess-org/mobile/main/lib/src/view/play/quick_game_matrix.dart>
- **PlayOK** puts the count in parentheses on the same line: `hearts (502)`.
- **Hearthstone** puts it under the icon as a bare number (cited above).
- **Lichess mobile** puts the incoming-challenge count in a **badge** on an app-bar icon
  (see §3.2), not as text.
- **Material 3** names this component explicitly: *"Badges are used to indicate a
  notification, item count, or other information relating to a navigation destination,"*
  with a small badge as *"a simple circle, used to indicate an unread notification"* and
  a large badge that *"contains label text communicating item count information"*
  (max four characters). <https://m3.material.io/components/badges/guidelines>
- **Apple** restricts the semantics deliberately — though note this is about the **app
  icon** badge, not an in-app one: *"A badge is a small, filled oval containing a number
  that can appear on an app icon to indicate the number of unread notifications that are
  available,"* and *"Use a badge only to show people how many unread notifications they
  have. Don't use a badge to convey numeric information that isn't related to
  notifications, such as weather-related data, dates and times, stock prices, or game
  scores."*
  <https://developer.apple.com/tutorials/data/design/human-interface-guidelines/notifications.json>
  A pending invite *is* an unread notification, so it qualifies; a friends-online count
  would not.

**So: the owner is right that "3 waiting" is wrong, and wrong about why.** The
information is standard; rendering it as a phrase on a second line is what no game does.
`Play with friends` with a `3` badge is the convention. `Play with friends / 3 waiting`
is not.

### 1.5 What the platforms say

Neither Apple nor Material forbids or mandates a second line. What Apple does say:

- *"Keep item text succinct so row content is comfortable to read."* And, on picking a
  row style: *"you might need to display a small image in the leading end of a row,
  followed by a brief explanatory label."* — so a brief explanatory label in a row is a
  contemplated, supported thing.
  <https://developer.apple.com/tutorials/data/design/human-interface-guidelines/lists-and-tables.json>
  (the rendered page at
  <https://developer.apple.com/design/human-interface-guidelines/lists-and-tables> is a
  JS app and returns no body to a fetcher; the `.json` above is the same content the page
  loads.)
- On menu items specifically: *"For each menu item, write a label that clearly and
  succinctly describes it,"* and *"Remove articles like a, an, and the from menu-item
  labels to save space."* — brevity guidance about the label, silent on a second line.
  <https://developer.apple.com/tutorials/data/design/human-interface-guidelines/menus.json>
- On settings, which is the "Sound, language" case: *"Minimize the number of settings you
  offer,"* because *"too many settings can make the experience feel less approachable,
  while also making it hard to find a particular setting."* Listing a settings screen's
  contents on the row that opens it is the opposite move — it advertises the size of the
  thing you are asking the player not to think about.
  <https://developer.apple.com/tutorials/data/design/human-interface-guidelines/settings.json>

NN/g's menu-design guidance is about the *label*, not about supplementary lines: *"Use
Clear, Specific, and Familiar Wording for Link Labels"* and "use category labels that are
familiar and relevant" (<https://www.nngroup.com/articles/menu-design/>). There is no
NN/g guideline for or against menu-item descriptions — see §6.

### 1.6 The rule this evidence supports

1. **A second line is legitimate on a row that offers a *mode of play* the player has to
   choose between** — because the choice is genuinely ambiguous and the description
   disambiguates it. chess.com does exactly this and nothing else.
2. **A second line is not used on utility rows** — Leaderboard, Settings, Profile,
   Rules. chess.com leaves them bare; so does everyone else verified here. "Where you
   rank" and "Sound, language" have no precedent.
3. **Live state is a badge or a count, never a phrase.** "3 waiting" becomes a `3`.

Applied to this app, that means: `Offline`, `Play with friends`, `Online`,
`Pass and play` may each carry one short line saying who you are playing and how many.
`My profile`, `Rules & FAQ`, `Settings`, `Leaderboard` may not.

---

## 2. Where the account cluster lives

The owner rejected putting profile / friends / leaderboard / settings as rows under the
play list. The evidence supports him, and it is stronger than "most games do something
else": the placements below were read off actual screenshots at the cited URLs, and
three separate platform specs point the same way.

### 2.1 The dominant convention: a split between the two top corners

**Identity on the leading side, system/menu on the trailing side, and neither one in the
play list.**

- **Clash Royale** — screenshot at
  <https://interfaceingame.com/screenshots/clash-royale-main-menu/>. Top-left: the player
  badge, name, clan tag and trophy count. Top-right of the same row: a hamburger menu.
  Friends is a *third* thing — its own icon on the right edge, not in either corner and
  not under the Play button.
- **Brawl Stars** — <https://interfaceingame.com/screenshots/brawl-stars-main-menu/>.
  Top-left: the player avatar card (name, trophies, friend-request icon). Top-right:
  hamburger, beside the currency counters. `FRIENDS`, `CLUB` and `CHAT` are a vertical
  icon stack down the right edge.
- **Marvel Snap** — <https://www.gameuidatabase.com/gameData.php?id=1785>. Settings gear
  top-left, player portrait top-centre, currencies top-right. Nothing account-shaped in
  the bottom bar.
- **Lichess (web)** — the top-right of the nav holds search, the sign-in / register
  entry points and a settings gear. <https://lichess.org/>
- **Board Game Arena** calls this area by name. From BGA's own forum: the **"top right
  zone"** contains *"the top right Player menu, the friends menu, and the table icon,"*
  with karma, notifications and messages folded into that same Player menu.
  <https://forum.boardgamearena.com/viewtopic.php?t=23602>
- **chess.com (web)** is the variant where the persistent nav is a left rail rather than a
  top bar, and the account cluster is pinned to the **bottom of that rail** — the rail
  runs `Play / Puzzles / Learn / Train / Watch / Community / Other` and then, separated at
  the foot, `Search`, `Sign Up`, `Log In`, `Help & Support`, `English`.
  <https://www.chess.com/play>
- **Hearthstone** is the same split anchored to the bottom instead of the top: *"The main
  menu also features the common interface elements of the friends list and time display
  on the lower left, and the player's current gold total and Game Menu icon on the lower
  right."* <https://hearthstone.wiki.gg/wiki/Main_menu>

Across all of them: **two opposite corners, identity on one and system on the other, and
Friends broken out as its own control rather than folded into either.**

### 2.2 The bottom bar is for sections of content, not for the account

- **Clash Royale's** bottom bar is shop, cards, **Battle**, clan, events. No profile, no
  settings, no friends. (Same screenshot as above.)
- **Marvel Snap** — *"The bottom Navigation bar ideally has 5 options Shop, Collection,
  Main, Season pass, News."*
  <https://medium.com/design-bootcamp/marvels-snap-ui-ux-case-study-9f727d8f3875>
  Account, settings and friends are in the top corners instead.

### 2.3 What the platforms specify

- **Material 3, top app bar** is the most explicit statement anyone makes about this:
  *"In addition to a trailing avatar, search app bars can have up to two trailing icons on
  mobile... The leading element of a search app bar can be used for a product's logo...
  Don't use more than two trailing icon buttons with an avatar."* Avatar **trailing**
  (top-right), logo **leading** (top-left), for the variant Material recommends for home
  screens. <https://m3.material.io/components/app-bars/guidelines>
- **Material 3, navigation bar:** *"Navigation bars should be used for: Three to five main
  pages in the product... don't use a navigation bar [for accessing] single tasks."*
  Account and settings are not among the examples of what belongs there.
  <https://m3.material.io/components/navigation-bar/guidelines>
- **Apple HIG, tab bars:** *"A tab bar lets people navigate between top-level sections of
  your app... Use a tab bar to support navigation, not to provide actions."* Settings is
  an action, not a section.
  <https://developer.apple.com/tutorials/data/design/human-interface-guidelines/tab-bars.json>
- **Apple HIG, Game Center** is the one piece of guidance addressed specifically at a
  game's menu screen, and it names the corner outright: *"You can choose to present the
  access point at any of the four corners of the screen in a fixed position,"* and
  *"Display the access point in menu screens. Consider adding the access point to the main
  menu or the settings area of your game."* With a layout warning that matters here:
  *"Avoid placing controls near the access point."*
  <https://developer.apple.com/tutorials/data/design/human-interface-guidelines/game-center.json>
- **Apple HIG, Settings:** *"Put general, infrequently changed settings in your custom
  settings area,"* including *"options related to people's accounts"* — a separately
  invoked area, not a row among primary navigation.
  <https://developer.apple.com/tutorials/data/design/human-interface-guidelines/settings.json>

### 2.4 The honest counter-example

**Among Us does roughly what the owner rejected.** *"It contains buttons that bring them
to other sections of the game, which are: Play, Inventory, Shop, News, My Account,
Settings, Credits, and Quit (only on PC), all located on the left side."*
<https://among-us.fandom.com/wiki/Main_menu>

`My Account` and `Settings` sit in the same vertical button list as `Play`. Even here,
though, **Friends is broken out into its own top-right corner button** — so the one
verified precedent for the rejected pattern still keeps the social entry out of the list.
Whether Among Us visually demotes those two buttons within the stack could not be
verified (§6).

### 2.5 The rule this evidence supports

1. **Two corners, not a list.** Identity (username / avatar) on one side, system (gear) on
   the other. Both outside whatever container holds the play modes.
2. **Friends is its own control**, with the count badge on it — every verified example
   separates it from both profile and settings.
3. **Leaderboard is not a corner control.** No verified example gives it a top-level slot;
   chess.com puts it as a small bare link beneath the play panel, and Hearthstone and
   Clash Royale reach it through the profile. Its home is inside `My profile` (where it
   already is) or as a quiet link, not as a peer of the play modes.
4. **Nothing in the corner cluster gets a description** (§1.6.2).
5. **Keep the corner clear.** Apple's *"avoid placing controls near the access point"*
   applies directly: today the landscape layout puts the gear inside a wrapping user row
   in the left column, next to the Friends pill and a 17pt Log Out link — the opposite of
   a clear corner.

---

## 3. Pending invites on the home screen

### 3.1 What this app does today, for the record

Verified in the tree, because §3's whole point is that the current path is the documented
anti-pattern:

- `context/SocketContext.tsx` already holds the state. `PendingInvite` is
  `{ from: string; roomCode: string }`; the context exposes `pendingInvite`,
  `gameInvites: PendingInvite[]`, `clearInvite()` and `dismissGameInvite(roomCode)`
  (`context/SocketContext.tsx:30-43`).
- `SocketProvider` wraps the entire app, above the router
  (`app/_layout.tsx:124-132`) — so **the home screen can already read `gameInvites`
  today**, with no new state and no context change.
- On `friend:invite` the app fires a `NotificationBanner` with **`duration: 6000`**, whose
  `onPress` goes to `/(online)` — the join screen, with the code prefilled
  (`context/SocketContext.tsx:218-234`, `app/(online)/index.tsx:59-64`).
- After those six seconds, the invite survives **only** in `gameInvites`, and the only UI
  that renders that array is `app/(online)/friends.tsx:331-361` — Home → Play with
  friends → Friends. Three navigations.
- `gameInvites` is React state in a provider. It does not survive an app restart or a
  socket teardown.

So today: a 6-second toast, or a three-level dig, or the invite is effectively gone.
That is both anti-patterns in §3.4 at once.

One structural constraint for any fix: `joinRoom()` comes from `OnlineGameContext`, and
`OnlineGameProvider` is mounted **only inside the `(online)` group**
(`app/(online)/_layout.tsx:21`). A Join button on the home screen therefore cannot join
directly — it must navigate into `(online)` carrying the room code and have that screen
auto-join on the param. `app/(online)/index.tsx` already prefills the code from
`pendingInvite`; making it *act* on a `join` param is the whole delta between two taps
and one.

### 3.2 The patterns, ranked by taps to join

**Tier 1 — zero navigation: the friend's session is simply listed, and tapping it joins.**

1. **Fortnite "Joinable Parties" — the invite step is deleted.** A party set to Public or
   Friends Only *"will appear in friends' Joinable Parties list with no invite needed!"*
   The strongest form of the pattern: you do not wait to be invited, you see the open
   table. (Epic's Party Hub FAQ, via
   <https://www.ggrecon.com/guides/fortnite-party-joinability-settings/>; the Epic page
   itself is <https://www.fortnite.com/news/party-hub-faq> — see §6.)
2. **Steam rich presence `connect`.** *"'connect' — A UTF-8 string that contains the
   command-line for how a friend can connect to a game. This enables the 'join game'
   button in the 'view game info' dialog, in the steam friends list right click menu, and
   on the players Steam community profile."* One click, from three surfaces.
   <https://partner.steamgames.com/doc/api/ISteamFriends>
3. **Discord rich presence.** *"When configured with a 'Join' button, friends can jump
   directly into a user's game session from the profile card."*
   <https://docs.discord.com/developers/platform/rich-presence>

**Tier 2 — one tap from a persistent surface that is always there.**

4. **Lichess mobile: a badged icon in the home app bar, present only when there is
   something to act on.** This is the single closest precedent for what the owner is
   asking for, and it is readable in source:
   ```dart
   final inwardCount = challenges.value?.inward.length ?? 0;
   final outwardCount = challenges.value?.outward.length ?? 0;
   if (inwardCount == 0 && outwardCount == 0) {
     return const SizedBox.shrink();
   }
   return SemanticIconButton(
     icon: Badge.count(
       count: inwardCount,
       isLabelVisible: inwardCount > 0,
       child: const Icon(LichessIcons.crossed_swords, size: 18.0),
     ),
     ...
   ```
   <https://raw.githubusercontent.com/lichess-org/mobile/main/lib/src/view/home/home_tab_screen.dart>
   Three things to steal: the entry **does not exist** when the count is zero (no dead
   affordance on a first-run screen); the count is a **badge**, not a phrase (§1.4); and
   it sits in the top bar of the home tab, not inside a mode.
5. **Rocket League: invites in the friends list's own Notifications tab, accepted
   inline.** *"Party Invites (invitations to join someone's party) can be found in the
   Notifications tab of the Friends List. To accept a party invite, select the green
   check mark in the popup."*
   <https://support.rocketleague.com/hc/en-us/articles/360018225433-Party-System-Changes-Friends-Update->
6. **chess.com: accept and the game is already running.** *"Your friend will get a
   notification, and the game will start as soon as they accept!"* — no lobby, no
   settings step between accepting and playing.
   <https://support.chess.com/en/articles/8588467-how-do-i-play-a-friend>

**Tier 3 — the invite carries its own connection, but the game must present it.**

7. **PlayFab Lobby.** *"The invited player receives the invitation via
   `PFLobbyInviteReceivedStateChange` and can use the attached connection string to join
   the lobby."*
   <https://learn.microsoft.com/en-gb/gaming/playfab/features/multiplayer/lobby/lobby-invites>
8. **Apple Game Center / GameKit.** *"Your game never directly creates GKInvite objects.
   Instead, these objects are created by GameKit and delivered to your game's matchmaking
   event handler."* Apple hands you the invite and leaves the accept surface to you.
   <https://developer.apple.com/documentation/gamekit/gkinvite>
   The HIG adds that Game Center's default multiplayer interface *"lets a player invite
   nearby or recent players, Game Center friends, and contacts,"* and recommends
   *"Use party codes to invite players to multiplayer activities."*
   <https://developer.apple.com/tutorials/data/design/human-interface-guidelines/game-center.json>

**Tier 4 — a code the player has to carry.**

9. **Among Us room codes** — the player types a code obtained out of band, and the code
   dies with the lobby. Only secondary sources found; see §6.

### 3.3 What actually makes one joinable in a single tap

Reading across Tiers 1–2, the joinable ones share four properties, and none of them is
about the visual container:

1. **The affordance lives on a surface the player is already looking at** — the friends
   list, the profile card, the home app bar. Not inside the mode it belongs to.
2. **The action is on the item itself.** Every Tier-1/2 example puts a Join or an accept
   control *in the row*. A badge alone is a count, not a join — Lichess's badge opens a
   list whose rows carry the accept.
3. **It is absent when there is nothing to act on.** Lichess returns `SizedBox.shrink()`.
   A permanent "Invites (0)" row is a dead row on the screen a new player sees first.
4. **It is durable.** It is a list you can come back to, not a six-second window.

### 3.4 Anti-patterns, with sources

- **The transient toast you have to catch.** chess.com's own support article documents
  the failure mode from the user's side: *"you have to click on it the moment it appears,
  or it is too late,"* because by then *"someone has accepted the challenge before you or
  the user has cancelled its challenge."*
  <https://www.chess.com/forum/view/help-support/you-cannot-accept-a-challenge-at-this-moment>
  **This app's banner is `duration: 6000`.**
- **The invite that silently expires.** chess.com designs *around* this by splitting the
  two cases: a Live challenge requires the friend to be online and accept within minutes,
  while Daily challenges *"remain active until accepted regardless of the opponent's
  status."*
  <https://support.chess.com/en/articles/8588467-how-do-i-play-a-friend>
- **The badge that is always on.** *"If it's always there, it might as well not be there
  at all"* — habituation to a permanent red dot, plus the warning that *"pestering people
  with 'clickbait' notifications may work short term, but if you use this approach too
  often, you run the risk of frustrating recipients."*
  <https://www.braze.com/resources/articles/beware-red-dot-badging>
  This is the argument for rendering the invite slot **only** when `gameInvites.length > 0`.
- **Buried in a submenu.** No first-party design guideline was found that names this as an
  anti-pattern (see §6). The evidence for it here is the positive convention rather than a
  prohibition: every Tier-1/2 example above puts the invite on a surface the player passes
  anyway, and this app puts it three navigations deep.

---

## 4. Ambient motion behind a title

The four `FloatingCard`s stay. The question is only how to stop them competing.

### 4.1 Games that do it, with sources

- **Hades.** A UI retrospective on Supergiant's title screen describes it as setting the
  tone — *"The title screen sets the tone for the rest of motion designs: flashy, snappy,
  and crispy"* — and names the moving parts: *"the rotation of the mirror in this
  animation"* and *"the animated gems in the background."*
  <https://medium.com/@donxu29/wip-9e7289c913e4>
- **Hearthstone.** *"It's physical. You can almost feel it as it opens and reveals the
  main menu,"* with *"each interface element ... consistent with the tavern theme"* and
  *"each animation has a deliberate impact."* The same article is critical where the
  flourish stops paying for itself, which is the useful half.
  <https://medium.com/@matt.tsui/hearthstone-design-thinking-inside-the-box-78dbacb96040>
- **Balatro.** The wiki confirms the main menu appears *"either when they click/press the
  screen after Jimbo shows up or when the pre-main menu animation is done playing,"* with
  the logo at the top and the buttons in the lower part — i.e. the animated zone and the
  button column occupy different bands of the screen.
  <https://balatrowiki.org/w/Main_menu>

### 4.2 The techniques, and what backs them

1. **Separate the bands.** Motion above, controls below (Balatro, cited above). This app
   already half does it — the cards are absolutely positioned at `top: "12%"` — but in
   portrait they sit *behind* the wordmark and drift into the row stack. Confining them
   above the menu's top edge is the cheapest single change.
2. **No position shift is the least distracting motion; the least distracting of all is
   none.** NN/g: elements that slide or shift position *"attract attention faster than
   elements that slowly fade into place,"* and the calmer options are *"a more subtle
   animation with no position shift"* or *"No animation at all... if possible."*
   <https://www.nngroup.com/articles/animation-usability/>
   A ±20px bob is a position shift. It is defensible because it is slow, low-contrast and
   not in the reading path — but it is not free, and it is the reason the cards must stay
   out of the button column rather than merely behind it.
3. **Purposeful, not overshadowing.** NN/g: *"Animation in UX must be unobtrusive, brief,
   and subtle,"* and using animation to *"hijack the users' attention... is a dark
   pattern."* <https://www.nngroup.com/articles/animation-purpose-ux/>
   Apple HIG, Motion: *"Add motion purposefully, supporting the experience without
   overshadowing it,"* and *"gratuitous or excessive animation can distract people and may
   make them feel disconnected or physically uncomfortable,"* plus *"make motion
   optional."*
   <https://developer.apple.com/tutorials/data/design/human-interface-guidelines/motion.json>
4. **Low contrast is the other lever.** The existing opacities (0.15–0.25) and the
   felt-gradient fill against a felt-gradient background are already doing this. No named
   game was found that publishes numbers for this; see §6.
5. **It must be pausable, or it must respect the OS flag.** WCAG 2.2.2, Pause, Stop,
   Hide: *"For any moving, blinking or scrolling information that (1) starts
   automatically, (2) lasts more than five seconds, and (3) is presented in parallel with
   other content, there is a mechanism for the user to pause, stop, or hide it unless the
   movement, blinking, or scrolling is part of an activity where it is essential."*
   <https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html>
   An endless decorative loop meets all three conditions and is by construction not
   essential. **The app already satisfies the spirit of this**: `FloatingCard` returns
   early under `usePrefersReducedMotion()` and the cards simply sit still
   (`app/index.tsx:172-176`). The gap is that the OS flag is the only control — there is
   no in-app one — which is worth recording rather than fixing here.
   WCAG 2.3.3, Animation from Interactions (AAA), covers the interaction-triggered case:
   *"Motion animation triggered by interaction can be disabled, unless the animation is
   essential,"* intended *"to allow users to prevent animation from being displayed...
   Some users experience distraction or nausea from animated content."*
   <https://w3c.github.io/wcag21/understanding/animation-from-interactions.html>
6. **The menu has to survive the motion in both orientations.** Apple's games guidance:
   *"in-game menus need to remain legible and easy to use on every device — and, if you
   support them, in both orientations on iPhone and iPad — without obscuring other
   content,"* with the recommendation to *"consider using dynamic layouts that rely on
   relative constraints."*
   <https://developer.apple.com/tutorials/data/design/human-interface-guidelines/designing-for-games.json>
   Note the current landscape branch drops from four cards to two and pins both at
   `x = 20` and `x = 90` — i.e. inside the left column, over the wordmark. That is the
   right instinct already.

### 4.3 The rule

Keep the cards. Keep them **out of the rectangle the buttons occupy**, keep them slow,
keep them under 0.25 opacity, and keep the reduced-motion early-return. Everything in
§5 assumes a motion band that the interactive column does not enter.

---

## 5. Five layout ideas for this home screen

Every idea below: uses only values already in `lib/tokens.ts`; is a complete design in
**both** orientations, because menus are not orientation-locked; renders the invite slot
only when `gameInvites.length > 0`; puts the account cluster in a corner rather than in
the play list; and carries a second line **only** on play-mode rows (§1.6).

Each is a different structure taken from a different verified precedent, so they can be
built as mockups and compared rather than blended.

### Idea 1 — "The Play Panel" (chess.com's shape, taken literally)

The home screen stops being a list of everything and becomes one titled panel of *ways to
play*, each row saying in one short line who you play and how many — the exact object at
<https://www.chess.com/play>, in this app's palette. Everything that is not a way to play
leaves the panel: the account cluster goes to a corner, Rules and Tutorial become two
small text links under the panel, the way chess.com's `Game History` and `Leaderboard`
sit under its six. Hierarchy comes from the panel's enclosure plus one gold-filled row,
not from seven rows shouting equally. This is the lowest-risk idea and the only one whose
reference implementation can be read side by side with the mockup.

- **Hero:** the panel itself (`Colors.bgCard` fill, `Radius.lg`, `Colors.goldBorder`
  hairline), titled `PLAY` in `Colors.gold` at `FontSize.sm`. The panel is the primary
  object; no separate CTA competes with it.
- **Modes, one row each, `minHeight: TOUCH_TARGET_MIN`, icon + label + description:**
  `Resume game` / "Offline, against the computer" — gold-filled, only when a save exists;
  `Offline` / "2–4 players against the computer"; `Play with friends` / "Private room,
  invite by code"; `Online` / "Quick match against anyone"; `Pass and play` / "One phone,
  2–4 players". Label `Rajdhani_600SemiBold` `FontSize.lg` `Colors.text`; description
  `Inter_400Regular` `FontSize.xs` `Colors.textMuted`.
- **Invite:** the first row of the panel, above everything including Resume, and the only
  other gold row on the screen (`Colors.goldMuted` fill, `Colors.goldStrong` border):
  avatar initial + "**Ana** invited you" + a `Join` pill on the trailing edge. One row per
  entry in `gameInvites`. The whole row is the button; the pill is `a11yHidden`. Absent
  entirely when the array is empty (§3.3.3).
- **Account:** a top-right corner cluster, outside the panel — username chip (→
  `/(online)/profile`), friends icon with a `Colors.danger` count badge, gear. No
  descriptions on any of them (§1.6.2).
- **Learn:** `Tutorial` and `Rules & FAQ` as two `FontSize.sm` `Colors.textSecondary`
  text links in a 44pt row under the panel.
- **Portrait:** motion band `Spacing.xxl` tall holding the wordmark and the drifting
  cards; account cluster overlaid top-right; panel below, scrolling; the two learn links
  pinned under it.
- **Landscape:** one 44pt band across the top — wordmark left, account cluster right —
  then the panel centred at `flex: 1` with a `maxWidth`, its rows in **two columns** when
  the window is wide enough that a single column would leave the panel half-empty. The
  motion band is the top band only; no card drifts below it.

### Idea 2 — "Corner Access Point" (Apple's Game Center placement, taken literally)

Apple's own guidance for a game's menu screen is that the social/progress entry point is
a single control in a fixed screen corner (§2), so this idea collapses the entire account
cluster into exactly one corner control and gives the whole rest of the screen to a 2×2
grid of mode tiles. It is the idea that reads least like a settings screen and most like
a game, and it is the one that most reduces the number of top-level choices — four tiles,
one corner control, one invite band.

- **Hero:** the 2×2 grid. Each `HomeModeTile` is a square-ish `Colors.bgSurface` card,
  `Radius.lg`, `Colors.goldBorder`, icon at 28 over a label at `FontSize.md` over a
  description at `FontSize.xxs` `Colors.textMuted`. The tile that is the recommended
  action (Resume if a save exists, else Offline) takes the gold gradient.
- **Modes:** `Offline`, `Play with friends`, `Online`, `Pass and play`. Always four —
  when a save exists, `Resume` replaces `Offline` in the top-left and `Offline` becomes a
  ghost link under the grid.
- **Invite:** a full-width band immediately **above** the grid, `Colors.goldMuted` fill,
  `Radius.md`, `Spacing.cosy` padding: avatar + "**Ana** is waiting · Room 4F2K" + `Join`.
  Stacked, one per invite, max two shown with a "+N more" that opens Friends. Absent when
  empty — the grid moves up.
- **Account:** one 44×44 circular control in the **top-right**, carrying the friends count
  badge. Tapping it opens a small sheet (not a new screen) with `My profile`, `Friends`,
  `Leaderboard`, `Settings`, `Log out`. Apple: *"Consider adding the access point to the
  main menu or the settings area of your game,"* and *"Avoid placing controls near the
  access point"* — so the wordmark centres and nothing else enters that corner.
- **Learn:** `Tutorial` and `Rules & FAQ` as two ghost links under the grid.
- **Portrait:** wordmark + motion band, invite band, 2 columns × 2 rows of tiles, ghost
  links. Nothing scrolls at iPhone SE height.
- **Landscape:** the grid becomes **4 columns × 1 row** (Android's own guidance is that a
  phone in landscape is compact-height and two-pane layouts are impractical there — cited
  in the previous round). Wordmark and access point share the top band; the invite band
  spans the width below it; the tiles sit in one row under that. The motion band is the
  top band.

### Idea 3 — "The Continue Strip" (Lichess mobile's ongoing-games carousel)

Lichess mobile's home is not a menu of destinations; it is a feed whose first section is
*things you can continue right now*. Applied here, the top of the screen becomes one
horizontally scrolling strip of live objects — the saved offline game, each pending
invite, and later a friend's open table — each a card with one tap to enter it. The mode
list underneath goes quiet and compact, because it is the cold-start path and the strip is
the warm one. This is the idea that best serves the owner's actual request, because an
invite is not a special case in it: it is just another live object in the same strip.

- **Hero:** the strip. Each card is `Spacing.xxl`-tall, `Colors.bgSurface`,
  `Radius.md`, `Colors.goldBorder`, width ~62% of the window so the next card peeks and
  the strip announces itself as scrollable. The whole card is the button.
- **Strip contents, in this order:** pending invites (`Colors.goldMuted` fill: avatar,
  "**Ana** invited you", `Join`); the saved offline game ("Resume · 3 players, hand 4");
  nothing else yet. **When the strip is empty it does not render**, and the first mode row
  is promoted to a gold hero row instead — so a first-run screen has no empty container
  on it.
- **Modes:** a compact row list under the strip, `HomeMenuRow` at `FontSize.md`, each with
  its one-line description: `Offline`, `Play with friends`, `Online`, `Pass and play`.
- **Account:** top-right corner cluster (username chip, friends+badge, gear), as Idea 1.
- **Learn:** `Tutorial`, `Rules & FAQ` as the last two rows, `Colors.textSecondary`, no
  descriptions.
- **Portrait:** wordmark + motion band → strip (horizontal) → mode rows → learn rows.
- **Landscape:** the strip **rotates**: it becomes the left column, a vertical list of the
  same cards, `flex: 1`; the mode rows take the right column. When the strip is empty the
  left column holds the wordmark and the promoted gold hero instead, and the layout is
  the current 38/62 split without its dead space. The motion band is the left column's
  top third only.

### Idea 4 — "One Door" (a single CTA whose identity is state-ranked)

The screen offers one gold button and the button knows what you most likely came for. Its
label is chosen by a strict ranking — a pending invite outranks a saved game, which
outranks a cold start — so the most time-critical thing is always the biggest thing, and
the runner-up is always available as a ghost link directly beneath it. Everything else is
a quiet row. This is the most aggressive simplification and the highest-variance one: it
is excellent when the ranking is right and mildly disorienting when the button changes
identity between two launches, which is a real cost the mockup should be judged on.

- **Hero:** one pill, `Radius.full`, `[Colors.goldLight, Colors.gold, Colors.goldDark]`,
  `minHeight` 60, label `Rajdhani_700Bold` `FontSize.xl` on `Colors.bg`, with a second
  line at `FontSize.xs` in `Colors.bgCard`. **The only gold fill on the screen.**
  1. `gameInvites.length > 0` → "Join Ana's game" / "Room 4F2K" (and, for a second
     invite, a `+1` badge on the pill that opens the list).
  2. `hasSavedGame` → "Resume game" / "Offline, against the computer".
  3. otherwise → "Play" / "2–4 players, offline".
- **Runner-up:** one ghost link under the pill, 44pt tall, `Colors.textSecondary`,
  `FontSize.sm` — "Start a new game instead", or when an invite is showing, "Resume your
  game instead" / "Play offline instead". The displaced option is never lost.
- **Modes:** four quiet rows, `Colors.bgSurface`, no gold, each with its description:
  `Offline`, `Play with friends`, `Online`, `Pass and play`.
- **Account:** top-right corner cluster.
- **Learn:** two ghost links at the bottom.
- **Portrait:** motion band, wordmark, pill, ghost link, `Spacing.xxl` gap, four rows,
  learn links. The pill is always above the fold.
- **Landscape:** two `flex: 1` columns. Left: wordmark, suits, pill, ghost link, centred.
  Right: the four rows plus the learn links, left-aligned, scrolling. Motion lives in the
  left column only, which is where it already is today.

### Idea 5 — "Bar and Rail" (Material's navigation bar ↔ navigation rail)

Instead of a home screen that holds every destination, the app grows a persistent
three-destination navigation surface — `Play`, `Friends`, `You` — which is a bar across
the bottom in portrait and a rail down the leading edge in landscape, and the home screen
becomes only the `Play` destination's content. The invite count becomes a badge on
`Friends`, which is precisely the component Material describes badges as being for. This
is the largest architectural change of the five and the only one that touches routing, so
it is the one to mock up if the owner wants to know what the app looks like a year from
now rather than next week. Material sizes it exactly — *"Navigation bars should be used
for: Three to five main pages in the product... don't use a navigation bar [for accessing]
single tasks"* (<https://m3.material.io/components/navigation-bar/guidelines>) — and Apple
sets the same constraint: *"Use a tab bar to support navigation, not to provide actions"*
(<https://developer.apple.com/tutorials/data/design/human-interface-guidelines/tab-bars.json>).
Three destinations is the floor, so `Settings` and `Log out` live *inside* `You` and never
become a fourth tab.

- **Hero:** within `Play`, a single gold row at the top — Resume if a save exists, else
  Offline — followed by the other modes as quiet rows with descriptions.
- **Modes:** all under `Play`: the gold row, then `Offline` (when not the hero),
  `Play with friends`, `Online`, `Pass and play`, then `Tutorial` and `Rules & FAQ` in a
  quieter weight.
- **Account:** `You` owns `My profile`, `Leaderboard`, `Settings`, `Log out`. `Friends`
  owns the friends list *and* the invite list. Nothing account-shaped is on `Play`, and
  no floating gear or gold Friends pill survives.
- **Invite:** a count badge on the `Friends` destination — small circle for one, numeral
  for several, per Material — **plus** an inline invite card at the top of `Play` while
  any invite is live, so a player who never leaves the first tab still gets a one-tap
  join. The badge alone is a count, not a join (§3.3.2).
- **Motion:** the drifting cards belong to the `Play` destination's background only, above
  its first row; the bar/rail is opaque `Colors.bgCard` and nothing drifts under it.
- **Portrait:** bottom bar, three destinations, `TOUCH_TARGET_MIN` tall plus
  `insets.bottom`; wordmark shrinks to `FontSize.hero` to pay for the bar.
- **Landscape:** the bar becomes a leading-edge rail, which is also where `insets.left`
  goes — the same trick the game table already uses. Content fills the rest at `flex: 1`,
  so there is no fixed percentage split and a tablet widens gracefully.
- **Cost, stated plainly:** three destinations means three `_layout` routes and a decision
  about what the app's root is. Do not mock this up as a picture of a menu; mock it up as
  a picture of an app.

---

## 6. Could not verify

Listed so nothing above can be read as resting on it.

**Sources that would not yield a body to a fetcher**

- `developer.apple.com/design/human-interface-guidelines/*` renders client-side and
  returns only a `<title>`. Every Apple citation above except the Motion page therefore
  cites the `developer.apple.com/tutorials/data/...json` endpoint the page itself loads.
  The content is the same; the URL is not the one a human would visit.
- `m3.material.io/components/lists/*` — could not be retrieved at all. **No Material
  guidance on list supporting text is cited anywhere above.**
- **Every `m3.material.io` quote in this document (badges §1.4, app bars §2.3, navigation
  bar §2.3 / Idea 5) was read off the page rendered in a browser, not off a plain fetch.**
  A plain fetch of those same URLs returns the `<title>` and nothing else. The quotes are
  reproduced as read; if one becomes load-bearing for a decision, open the URL and confirm
  it rather than trusting this document.
- `developer.android.com/reference/kotlin/androidx/compose/material3/ListItem.composable`
  — returned only the navigation shell. No Compose `supportingContent` quote is used.
- `interfaceingame.com` and `gameuidatabase.com` return HTTP 403 / no body to a plain
  fetcher, and neither publishes written design commentary. The Clash Royale, Brawl Stars
  and Marvel Snap placements in §2.1 come from **opening those pages in a browser and
  looking at the screenshots they host** — direct visual inspection, not quoted prose. If
  you want a citable sentence rather than an observation, those three are the weakest
  links in §2.
- `en.boardgamearena.com/gamelist` returned a stylesheet-failure page, so **no claim is
  made about what BGA's game tiles show**. The BGA "top right zone" quote in §2.1 comes
  from the forum, not from the site's UI.
- Material 3's motion principle wording ("Focused: Shows users what's essential without
  creating unnecessary distractions") surfaced only in a search summary; the page body
  could not be fetched. Not relied on above.

**Claims that exist only in secondary sources**

- **Fortnite Joinable Parties.** The wording quoted is attributed to Epic's Party Hub FAQ
  but was read on <https://www.ggrecon.com/guides/fortnite-party-joinability-settings/>,
  not on `fortnite.com`.
- **Among Us** room-code join flow and code expiry — Fandom wiki and guide sites only; no
  Innersloth support page was located.
- **Clash Royale / Brawl Stars** friendly-battle and team-invite flows — third-party
  guides only; no Supercell help-centre page.
- **Valorant's** in-game party-invite toast and its accept keybind — one guide site only;
  no Riot-authored page.
- **Discord** — the docs confirm a generic "Join" button; the distinct "Ask to Join"
  approval flow was **not** confirmed and is not claimed.
- **Hades' GDC/UI credits** and **Hearthstone's** GDC 2015 UI talk — referenced by the
  Medium retrospectives cited, not read at source (GDC Vault is paywalled).
- **Balatro's** background shader — only community recreations were found; no developer
  statement about the menu background's relationship to the buttons.

**Things nobody appears to have written down**

- **No UX authority found that either endorses or forbids a descriptive second line on a
  menu item.** NN/g's menu guidance is about the label's wording only
  (<https://www.nngroup.com/articles/menu-design/>). §1's verdict therefore rests on what
  named products actually do, not on a rule.
- **No first-party design guideline names "invite buried in a submenu" as an
  anti-pattern.** §3.4's last bullet is an inference from the positive convention.
- **No named game publishes numbers** for menu-background opacity, drift amplitude,
  rotation or loop length. §4's "under 0.25 opacity, slow, out of the button rectangle"
  is a synthesis of the NN/g and Apple guidance plus this app's existing values, not a
  benchmark against a named title.
- **Marvel Snap's** main-menu *background* rationale — no fetchable source. Its
  account-cluster placement in §2.1 is a screenshot observation; its bottom-bar contents
  are quoted from a third-party case study, not from Second Dinner.
- **chess.com's mobile app** home screen — no in-app screenshot could be obtained; the
  store listing shows marketing art only. §1.2 and §2.1 cite the **web** Play surface,
  which is structurally the same list but is not proof about the app.
- **Among Us** — the *text* of its left-side button list is verified, but not whether
  `My Account` and `Settings` are visually demoted within that stack. §2.4 says only what
  the wiki says.
- **Rocket League's** friends/party UI placement, and **Candy Crush Saga's** corner icons
  — conflicting or unfetchable sources. Neither is cited in §2.
- **Lichess challenge expiry** — the commonly repeated "20 seconds" could not be confirmed
  against the Lichess API spec. Not used.
- **Fall Guys** — no source fetched at all. Not cited.
- **Interface In Game / Game UI Database** were both named in the brief. Neither yielded
  quotable *text* — they are screenshot galleries with no design commentary — so the three
  claims drawn from them (§2.1, Clash Royale / Brawl Stars / Marvel Snap) are observations
  from looking at the hosted screenshots, and are flagged as such above.
- **Balatro, Hades, Hearthstone in §4.1** are the only three games for which a written
  account of the animated menu was found at all. Alto's Odyssey, Monument Valley, Rocket
  League, Celeste, Among Us, Candy Crush, Clash Royale, Brawl Stars, Slay the Spire,
  Stardew Valley and Vampire Survivors were all searched and produced nothing but
  wallpapers, mods and unsourced summaries. **§4's rule is therefore built on the platform
  and NN/g guidance, with three games as illustration — not on a survey.**
