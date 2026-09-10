# Context

Domain glossary and pointers to where a concept's design lives, sharpened over time by
`mattpocock-skills:domain-modeling`. Decisions that constrain future changes belong in
`docs/adr/`, not here.

## Terms

- **Account recovery** — the register / verify-email / add-email / resend-verification /
  request-password-reset / reset-password state machine. Its authoritative shape (states,
  transitions, the enumeration-safety and race-condition invariants) is
  `docs/superpowers/specs/2026-09-03-account-recovery-design.md`, cited by box number from
  every handler in `server/routes.ts`. A future review proposing to consolidate this flow into
  an "owning module" should read that spec first — the state machine is already consolidated,
  just not as code, and each route's await-vs-fire-and-forget timing relative to `res.json()`
  is a deliberate per-route timing-oracle defense, not duplication.
