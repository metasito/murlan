# Beta playtest script

Four people, four devices, the deployed URL. Roughly an hour. Every line is a thing
the audit fixed that no human has watched work.

Record the result next to each line: ✅, or what happened.

## Setup
- [ ] Each player registers a new account on their own device. At least one on a phone
      browser, at least one on a laptop.
- [ ] One player registers with a mixed-case username (e.g. `MarcoRossi`), logs out, and
      logs back in typing it all lowercase.
- [ ] On a device set to Albanian or English, type something invalid at registration or
      login — a taken username, a too-short password. Does the error show in that
      language, not Italian?

## A full match, uninterrupted
- [ ] Host creates a room, the other three join by code.
- [ ] Play a whole match to the target. Between manches, watch the card exchange happen.
- [ ] Check the scoreboard names are right — not `player_0`.
- [ ] At the end, everyone votes rematch. It starts a new match.
- [ ] Open the finished match from your profile's history and press play on the replay.
      Does the pause icon actually draw, rather than showing a blank box?

## Someone leaves mid-hand
- [ ] Mid-hand, one player force-quits (close the tab / kill the app).
- [ ] The other three: does the table keep playing with a bot in that seat?
- [ ] Is there a visible marker on that seat for the rest of the match — not just a banner
      that disappears?
- [ ] With the bot still holding that seat, reach the card exchange between manches. Does
      it hand back a card on its own, without the hand stalling?
- [ ] Does the match finish, and is the seat that left recorded as last place?

## Someone loses signal
- [ ] Mid-hand, one player turns off wi-fi for ~20 seconds, then turns it back on.
- [ ] Do they come back into the same hand, with their own cards?
- [ ] Did the others see a "disconnected" notice, and then a "back" one?
- [ ] Do it again but stay offline for over a minute, past the grace period. What happens?

## The same account twice
- [ ] One player opens the app in a second tab while playing in the first.
- [ ] The first tab should say plainly that the account was opened elsewhere — not go
      silently dead.
- [ ] Does the first tab stop trying to reconnect, or do the two tabs fight?

## The lobby
- [ ] Two players add each other as friends. Does the online dot appear?
- [ ] One invites the other to a room. Does the banner arrive, and does tapping it work?
- [ ] Quickmatch with only one person waiting. What happens?
- [ ] Start a room with bot-fill and one human. Does it play a full match?

## The awkward ones
- [ ] On a small phone in landscape, look at both side seats' card fans. Do they lean in
      over the felt on both sides — not spill off the edge of the screen?
- [ ] Rotate a phone to portrait mid-game. Does the table survive?
- [ ] Open the settings modal in landscape. Does the app flip to portrait behind it?
- [ ] Turn the phone's text size up to maximum and look at the table. Is anything clipped?
- [ ] Turn on the OS "reduce motion" setting and play a card.
- [ ] Still with "reduce motion" on, win a hand. Does the celebration buzz once, not twice?
- [ ] Turn the volume up. Do you hear: the deal, a card, a pass, a bomb, the round close,
      the hand end?

## What broke

| What | Who saw it | Device | What happened |
|---|---|---|---|
| | | | |
