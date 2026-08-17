# Push notifications — design

**Backlog:** Q23. **Status:** design, not yet implemented.

## The queued premise is wrong, and the code says so

Q23 asks for "your turn" push notifications, calling them "the strongest
retention lever for a turn-based game". Murlan online is not a turn-based game
in that sense. It is real-time: four people sit at one table at the same time,
and the server enforces that with two clocks.

- `AFK_TIMEOUT_MS` — 30 s (`server/socket.ts:148`). A player who does not act
  inside it is auto-passed.
- `DISCONNECT_GRACE_MS` — 60 s (`server/socket.ts:149`). A player still absent
  after it loses the seat: `game:seat_bot_takeover` fires and a bot finishes
  the match in their place.

A push has to be delivered by APNs or FCM, land on a locked phone, be noticed,
and be acted on — the app opened, the socket reconnected, the state rejoined —
inside thirty seconds, or it arrives to announce a turn that has already been
passed. Inside sixty, or it arrives after the seat is gone. No amount of
implementation quality changes that arithmetic. Building it would ship a
feature whose best case is a notification for something the player can no
longer do.

Shortening the clocks to make room for it is not an option worth taking: they
exist so three people are not held hostage by a fourth's phone call.

## What the same infrastructure is actually for

There is a real gap next door, and it is the one a push fits without racing
anything:

```
// server/socket.ts, "friend:invite"
const friendSocket = userSocketMap.get(friendUserId);
if (!friendSocket) return;
```

An invite to a friend who is not connected is dropped on the floor. The
inviter is told nothing, and the friend never learns anyone wanted to play.
Nothing expires while it sits there — the room stays `waiting` until the host
starts it — so a notification delivered a minute later, or ten, is still worth
having. This is the "someone wants to play with you" case, which is what the
retention lever actually is for a game people play with friends.

A second trigger falls out of the same plumbing and is worth wiring once the
first is proven: the streak reminder. `lib/streak.ts` already computes the
consecutive-days count, and the day a streak is about to lapse is exactly the
day a nudge is worth sending.

**Decision:** build the push infrastructure, wire it to invites, leave a place
for streaks, and do not build turn notifications. Recorded here rather than
asked, per the standing agreement.

## Storage

A new table, `push_tokens`:

| column | type | notes |
|---|---|---|
| `token` | `text` primary key | Expo's own push token. Globally unique, so it is the key |
| `user_id` | `varchar` → `users.id`, cascade delete | Reassigned if a device changes hands |
| `platform` | `text` | `ios` / `android`, for diagnosing a delivery failure |
| `updated_at` | `timestamp` | Lets a stale token be pruned without a receipt round-trip |

Following the order of preference in CLAUDE.md: it cannot be derived, there is
no jsonb column on `users` to ride, and a new column on `users` is the option
that CLAUDE.md warns about specifically — `users` is written on every login,
and a column that exists in the schema but not yet in the database fails those
writes until `db:push` runs. One user has many devices, which a column would
have to model as an array anyway. A table is the right shape and the safer one.

`token` as the primary key, not a surrogate id: the same device re-registering
must overwrite rather than accumulate, and an upsert on the natural key is one
statement.

## Sending

`server/push.ts`, one function:

```ts
sendPush(tokens: string[], message: PushMessage): Promise<void>
```

It POSTs to `https://exp.host/--/api/v2/push/send`. **No `expo-server-sdk`
dependency.** The SDK's value is chunking (100 messages per request) and
receipt polling; every send here is one message to one person's devices, so
both are dead weight. The endpoint is a plain JSON POST and the response names
the failures.

A `DeviceNotRegistered` response deletes that token. That is the only receipt
handling worth having: it is what stops a reinstalled app from accumulating
dead rows forever.

Failures are logged and swallowed. A push that does not arrive must never fail
the socket event that triggered it — the invite still reaches a connected
friend, and the game is unaffected either way.

## Client

`expo-notifications` is a new dependency, and the only way to obtain an Expo
push token. It is Expo-managed, so it adds no local native build step and
nothing that breaks Replit — the web bundle never calls it.

- Permission is requested **at the point of value**, when the player opens the
  Friends screen, not at launch. A launch-time permission prompt for a game
  the player has not yet decided to play with anyone is the request most
  reliably denied, and iOS only asks once.
- On grant, the token is POSTed to `/api/push/token`.
- Logout and account deletion delete the row. Deletion is already covered by
  the cascade; logout needs an explicit `DELETE /api/push/token`, because the
  next person to use that device must not receive the previous one's invites.

**No settings toggle, and no column for one.** Whether a player wants these is
already expressed by the OS permission and by whether a token is registered:
revoking permission in system settings stops delivery, and logging out removes
the row. A second in-app switch would be a duplicate source of truth for a
state the platform already owns, and would need a column on a hot table to
hold it.

## What ships inert

Without FCM (Android) and APNs (iOS) credentials uploaded to EAS — tracked as
O7 — Expo's service accepts the request and cannot deliver it. Every layer
below that works and is exercised: the token is stored, the trigger fires, the
request is made, the failure is logged. Nothing is stubbed and nothing is
guarded off. When the credentials arrive the notifications simply start
arriving, with no code change.

## Testing

- `push_tokens` reads and writes, including the upsert-on-reregister and the
  cascade on account deletion — the integration suite, against a real database,
  the same way `tests/integration/ladderAndReplay.test.ts` covers the tables it
  added.
- `sendPush` against a stubbed `fetch`: the request shape, and that a
  `DeviceNotRegistered` response deletes the token.
- The invite trigger: an invite to a disconnected friend reaches the send path;
  an invite to a connected one does not (they got the socket event, and a
  duplicate notification for something already on screen is the most annoying
  failure mode this feature has).
- That a push failure cannot break the socket event that triggered it.

## Explicitly not built

- Turn notifications. See above.
- A notification for every game event. The invite is the one thing that happens
  while the player is not there to see it.
- `expo-server-sdk`.
- An in-app toggle.
