# LOOP STATE

status: IDLE                 # IDLE | RUNNING | HALTED | DONE
objective:                   # one line: what this run is for. Never rewritten mid-run.
run_started:
baseline: main
gate_cmd: npm run agent:check
budget: 0/5                  # tickets landed / max
queue: []                    # issue numbers, in pick order

## Current
ticket:
title:
branch:
worktree:
phase:                       # A Take | B Scope | C Build | D Review | E Land | F Close
phase_note:                  # what is half-done, in one line

## Evidence
<!-- Phase E refuses to push while any line here is empty. This is the whole
     anti-forgetting mechanism: a phase that was skipped leaves a blank. -->
dod:                         # A: the ticket's Definition of done, as a checklist
recon:                       # B: files to touch
verdict:                     # D: LAND | HOLD - reason
gate:                        # E: agent:check PASS <tree>
ci_run:                      # E: run id + conclusion
pr:                          # E: PR number

## Landed
## Parked
