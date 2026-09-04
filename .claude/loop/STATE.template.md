# LOOP STATE

Copied to `<git-common-dir>/loop/STATE.md` by phase 0. That copy is the live one and is never
tracked; this file is only its shape. Rewrite the live copy at every phase transition, before
doing the next thing — nothing you remember counts, only what is on disk.

status: IDLE                 # IDLE | RUNNING | HALTED | DONE
objective:                   # one line: what this run is for. Never rewritten mid-run.
run_started:
baseline:                    # the origin/main sha this run started from
budget:                      # tickets done / tickets allowed

## Current

ticket:
title:
branch:
worktree:
phase:                       # A Take | B Scope | C Build | D Review | E Land | F Close
phase_note:                  # one line: what is in flight right now

## Evidence

Each line is filled by the phase that earned it. A blank one means that phase did not finish, and
`node scripts/loop-gate.mjs` refuses the push naming it.

dod:                         # A: the ticket's Definition of done, as a checklist
recon:                       # B: files to touch, patterns to reuse, risks
verdict:                     # D: copy the reviewer's last line verbatim. Only `VERDICT: LAND`
                             #    is permission; anything else refuses, including a blank.
gate:                        # E: what `npm run agent:check` said, including what it skipped
ci_run:                      # E: the ciVerdict JSON
pr:                          # E: the pull request url

## Landed

## Parked
