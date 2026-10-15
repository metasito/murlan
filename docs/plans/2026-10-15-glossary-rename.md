# Glossary rename: the wire and the stored names

`CONTEXT.md` § The game fixes one English word per concept. Most of the rename is inside one
process and `tsc` checks it; this note covers the names that leave a process — the socket
protocol, the `GameState` jsonb in `active_games`, and the database columns — where a rename
breaks a reader the compiler cannot see.

## Why a hard cut is safe

Murlan is not live: no player data to keep, no installed client older than this commit to keep
talking to. So each name changes in one commit, with no alias, no dual read and no migration of
stored rows.

- **Socket.** Client and server ship from one bundle. `MIN_PROTOCOL_VERSION` is bumped, so a
  browser still holding the old bundle is refused at the handshake instead of reading
  `undefined` off a renamed field.
- **`active_games.state` (jsonb).** A row written before the deploy holds the old field names.
  Rehydrating it would read `trickWinner` as `undefined` mid-round. With no live games the rows
  are disposable: the deploy that carries this change starts with that table empty.
- **Columns and tables.** `ensureSchema()` is additive, so a renamed column would come up as a
  new empty column beside the old one. Each renamed column joins `RENAMED_COLUMNS` in
  `server/store/schemaDdl.ts`, which refuses to boot until `npm run db:push` has carried it out;
  renamed tables join the same check.

## The renames

| Where | Old | New | Why |
|---|---|---|---|
| `GameState` | `roundWinner` | `trickWinner` | it names who won the trick |
| `GameState` | `rankings` | `finishingOrder` | _Avoid_: rankings |
| `GameState` | `gameOver` | `roundOver` | it is set when the round ends, not the match |
| `ExchangePhase` | `bothJokersException` | `twoJokerException` | the glossary's name |
| `StartReason.type` | `won_no_swap` | `won_no_exchange` | _Avoid_: swap |
| `Player.type` | `"ai"` | `"bot"` | _Avoid_: AI |
| event | `game:over` | `game:round_over` | it fires once per round |
| `game:match_state` | `handsPlayed` | `roundsPlayed` | a hand is the cards a seat holds |
| table | `match_history` | `round_history` | one row per round |
| table | `match_replays` | `round_replays` | one replay per round |
| column | `match_replays.rankings` | `round_replays.finishing_order` | _Avoid_: rankings |
| column | `user_stats.games_played` / `games_won` | `rounds_played` / `rounds_won` | counted per round |
| column | `user_ratings.games` | `rounds` | a rating moves once per round |

`StartReason.type` `lost_round` keeps its name: it already means the seat lost the previous
round.

## Not changed

Translation keys follow their code (`partitaBoard.*` becomes `matchBoard.*` in every locale);
the strings players read stay as each language says them. Sound asset files are renamed with
their cue names.
