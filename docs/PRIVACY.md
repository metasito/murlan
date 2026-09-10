# Murlan — Privacy Policy

*Last updated: 2026-09-10*

Murlan is a card game. This policy describes exactly what the app and its server collect,
why, how long it is kept, and how to have it deleted. It matches the code in this repository
as of the date above — search the referenced files if you want to verify anything here
yourself.

## What we collect

**Account information.** Creating an account collects a username and a password (stored as a
salted hash, never in plain text). You may add an email address; if you do, we record it and
whether you've verified it. Email is used only to verify your address, reset your password,
and (if you're invited to a game) notify you. We never sell or share it for marketing.

**Push notification tokens.** If you enable push notifications, your device registers a token
with the Expo push service so we can deliver invite and game-state notifications through it.
We store the token, your platform (iOS/Android), and your app's language setting — nothing
else about your device.

**Game data.** Match history, ratings, and stats are recorded against your account so you can
see your own progress and results. Recent matches are also kept as replays for a limited time
(14 days) so you can review a hand after playing it, then the replay is deleted automatically.

**Crash and bug reports.** If the app crashes or errors, a report is sent automatically,
containing the error message, a stack trace, your app version, platform, and the screen you
were on — never your game state or cards. If you were signed in when it happened, the report
is linked to your account so we can follow up; if you weren't, it isn't linked to anyone. If
you use the in-app "report a bug" form, that report is always linked to your account (so we
can respond), and additionally includes your device's language setting. Both kinds of report
are kept for 90 days, then deleted automatically.

**Usage events.** The server logs a small number of first-party events (such as "match
started") for understanding how the app is used in aggregate. These are written by the server,
not the client, are linked to your account when you're signed in, and are kept for 90 days,
then deleted automatically. We do not use any third-party analytics or tracking service —
no Google Analytics, no Sentry, no ad SDKs.

## Third parties

- **Resend** sends our transactional email (verification, password reset). Your email address
  and the content of that message pass through Resend to deliver it. Resend does not receive
  any other account data.
- **Expo/EAS** delivers push notifications on our behalf. Your push token and notification
  content pass through Expo's push service. Expo does not receive your email, password, or
  game data.

We do not show ads, and we do not offer real-money play — nothing here is collected for
either, because neither exists in the app.

## Your data, your control

You can delete your account at any time from Settings. This is permanent and immediate: your
account row and everything linked to it — game history, ratings, stats, bug reports, crash
reports, push tokens, and pending email-verification/reset tokens — is deleted from our
database. There's no recovery period and no way for us to undo it once it's done.

There is currently no self-service data export. If you'd like a copy of your data before
deleting your account, contact us at the address below and we'll provide it.

## Retention summary

| Data | Kept for |
|---|---|
| Account (username, email, game history, ratings, stats) | Until you delete your account |
| Match replays | 14 days, then auto-deleted |
| Crash reports, bug reports, usage events | 90 days, then auto-deleted |
| Push token | Until you disable push or delete your account |

## Contact

[contact address — to be added once #44 settles the app's hosting domain]
