# Domain docs

Where to read, only. What an agent must *do* is in `docs/agents/RULES.md`.

Single-context repo. Decisions live in `docs/adr/`, indexed by `docs/adr/README.md`.

`CONTEXT.md` is the glossary: a term the repo argues about, what it means here, and where its
design lives. `/domain-modeling` grows it lazily, one term at a time as each gets resolved — a
term it does not yet carry is not a gap to fill upfront.

Before working an area, read `CONTEXT.md` for its terms and the ADRs that touch it. When your output names a domain concept —
an issue title, a test name, a hypothesis — use the repo's own word for it. Inventing a synonym
for something the code already names is how two vocabularies start.

If your change contradicts an ADR, say so explicitly rather than quietly overriding it:

> _Contradicts ADR-0002 (a play leaves the seat it was thrown from), but worth reopening because…_
