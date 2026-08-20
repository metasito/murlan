# Tournaments — design

**Date:** 2026-08-16
**Covers:** issue #58, the last of the original seven still unbuilt.

**Verdict: not now. Recorded so the shape is known when the precondition
clears.**

The project-wide constraints this would be built under — the storage order of
preference, server authority, Replit, localization, the socket invariants —
live in `CLAUDE.md` and are not restated here.

---

## What makes this one different

Every other item in that set needed new *storage*. Tournaments need new
*coordination*: a tournament owns many rooms at once, advances players from one
to the next as results land, and has to survive a restart with players sitting
mid-match.

That is a scheduler. And a scheduler whose state lives in memory, on a single
always-on instance, is where the hosting question stops being theoretical — it
is the first feature whose correctness depends on the process not going away.

## The precondition

Move the server somewhere with no cold starts, or accept that a sleeping Repl
ends a tournament partway through and strands everyone in it.

That decision is `docs/adr/0001-keep-react-native-expo-client-and-replit-host.md`
(the hosting question), and it is the owner's. Tournaments stay deferred with it.
Building the scheduler first
would mean writing the one feature that cannot tolerate a sleep, onto a host
that sleeps.

## What is already in place

Nothing here needs inventing when the time comes:

- Rooms, seating and the full match lifecycle already exist and are driven by
  the server (`server/socket.ts`).
- A finished match already reports placement — `handleGameOver` computes the
  finishing order the ladder rates (`server/ratings.ts`), which is exactly the
  input a bracket advances on.
- `active_games` already persists a live table across a restart, so a
  tournament's *matches* survive what its *scheduler* currently would not.

The gap is only the layer above: a bracket, its rounds, and a durable record of
which round each player is in.
