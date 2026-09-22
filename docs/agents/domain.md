# Domain docs

Where the domain is written down. What an agent must *do* is in `docs/agents/RULES.md`.

- **Before working an area, read `CONTEXT.md` for its terms and the ADRs that touch it.**
  `CONTEXT.md` is the one glossary (single-context repo): a term the repo argues about, what it
  means here, where its design lives. `docs/adr/README.md` indexes the ADRs.
- **Name a domain concept with the repo's own word** — in an issue title, a test name, a
  hypothesis. A synonym for something the code already names starts a second vocabulary.
- **`CONTEXT.md` grows one term at a time**, as each is resolved (the
  `mattpocock-skills:domain-modeling` skill). A term it does not carry yet is not a gap to fill
  upfront.
- **Say so when your change contradicts an ADR**, rather than quietly overriding it:

  > _Contradicts ADR-0002 (a play leaves the seat it was thrown from), but worth reopening because…_
