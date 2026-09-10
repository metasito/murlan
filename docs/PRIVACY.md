# Murlan — Privacy Policy

*Last updated: 2026-09-10*

Murlan is a card game. This policy describes what the app and its server collect, why, how long
it is kept, and how to have it deleted. It matches the code that runs the service as of the date
above.

## What we collect

**Your account.** Creating an account requires a username, a password, and an email address. The
password is stored only as a salted hash — we never hold the password itself. Alongside those we
store a six-character friend code (so other players can add you), whether your email has been
confirmed, the date you registered, when you were last seen online, whether you've finished the
tutorial, and whether the account is an administrator of the service.

**Email.** Your address is used for exactly two things: confirming the address is yours, and
resetting your password if you forget it. We send no newsletters, no marketing, and no game
notifications by email, and we never sell or share your address. While a confirmation or reset is
outstanding we hold a hashed copy of the one-time code, which is discarded once it is used or
expires.

**Push notifications.** If you enable them, your device registers a token with the Expo push
service so we can tell you when a friend invites you to a game. That is the only push we send —
we do not push turn reminders or game results. We store the token, your platform (iOS or
Android), and your app's language, and nothing else about your device.

**Games you are playing.** While you are in a room, we store which room you are seated in, and —
if you host it — the room itself and the state of the hand being played in it, cards included, so
the game survives a disconnection or a server restart. This is deleted when the room ends.

**Social and finished-game data.** Your friends list, pending game invites, match history,
ratings, stats, and achievements are stored against your account so the game works and you can
see your own progress. Each finished hand is also kept as a replay for 14 days so the players in
it can review it — a match of several hands leaves several replays — after which it is deleted
automatically.

**Crash and bug reports.** When the app errors, it sends us a report containing the error
message, a stack trace (including which components were on screen), your app version, platform,
and the screen you were on — never your cards or game state. Reporting requires you to be signed
in, so these reports are linked to your account. The in-app "report a bug" form sends only what
you type plus the screen you were on, your app version, platform, and language — no error message
and no stack trace. Both are kept for 90 days, then deleted automatically.

**Usage events.** The server records a small, fixed set of events — entering the lobby, joining a
room, starting the tutorial, the first move of a game, a game being abandoned, a connection
closing, an email failing to send — to understand how the app is used. These are written by the
server, not by your device, are linked to your account while you're signed in, and are deleted
after 90 days. We use no third-party analytics or tracking — no Google Analytics, no Sentry, no
advertising SDKs of any kind.

**Session cookie.** Signing in sets a session cookie so the server knows it's still you between
requests. It is cleared when you sign out, when you change or reset your password (which ends
your other sessions), when you delete your account, and in any case 30 days after it is issued.

**Server logs.** Like any web service, our server writes an operational log line for each
request, which includes your IP address, the address requested, and your browser or device's
request headers. Your session cookie and any authorization header are removed before the line is
written. These logs exist so we can diagnose faults and abuse. They are held by our hosting
provider under its own retention, are not covered by the deletion windows above, and deleting
your account does not remove them. Contact us at the address below if this matters to you.

**On your own device.** The app stores some things locally, which never reach us: your signed-in
account details, any offline single-player game in progress, your chosen language, and your
sound and haptics settings. Deleting the app removes all of it.

## Third parties

- **Resend** delivers our verification and password-reset email. Your address and the contents of
  that message pass through Resend so it can be sent. Resend receives nothing else about you.
- **Expo** delivers push notifications. Your push token and the notification's text pass through
  Expo's push service. Expo receives no email address, password, or game data.
- **Our hosting provider** runs the server and holds the database and the server logs described
  above.

We show no advertising and offer no real-money play, so nothing here is collected for either —
neither exists in the app.

## Your data, your control

You can delete your account at any time from Settings. It is permanent and immediate, with no
recovery period: your account, friends list, invites, seat in any room, any room you host along
with the hand being played in it, match history, stats, ratings, achievements, crash and bug
reports, usage events, push tokens, outstanding email codes, and sessions are all deleted. Server
logs are the exception, as described above.

One thing is anonymised rather than deleted. A replay belongs to everyone who played that hand,
so deleting yours would take the other players' copy with it. Instead your account id and your
name are erased from the replay — other players see an unnamed seat — and the play itself remains
until the replay expires 14 days after the hand. A replay with no remaining players is deleted
outright.

There is no self-service data export today. Write to us at the address below and we will send you
a copy of your data.

## Retention summary

| Data | Kept for |
|---|---|
| Account, friends, match history, ratings, stats, achievements | Until you delete your account |
| Room seat and in-progress hand | Until the room ends |
| Replays | 14 days after the hand |
| Crash reports, bug reports, usage events | 90 days |
| Email confirmation and password-reset codes | Until used, or until they expire |
| Push token | Until you sign out, uninstall the app, register a sixth device (we keep your five most recent), give the device to someone who signs in on it, or delete your account |
| Session cookie | 30 days, or until you sign out, change your password, or delete your account |
| Server logs | Our hosting provider's retention; not removed by account deletion |

## Contact

Questions about this policy, or a request for a copy of your data:
**privacy@** *(address to be filled in at publication)*
