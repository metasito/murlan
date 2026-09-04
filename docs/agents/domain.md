# Domain docs

Where to read, only. What an agent must *do* is in `docs/agents/RULES.md`.

Single-context repo. Decisions live in `docs/adr/`, indexed by `docs/adr/README.md`.

There is no `CONTEXT.md` yet. `/domain-modeling` creates one lazily, when a term actually gets
resolved — its absence is not a gap to fill upfront, so don't flag it or offer to write one.

Before working an area, read the ADRs that touch it. When your output names a domain concept —
an issue title, a test name, a hypothesis — use the repo's own word for it. Inventing a synonym
for something the code already names is how two vocabularies start.

If your change contradicts an ADR, say so explicitly rather than quietly overriding it:

> _Contradicts ADR-0002 (a play leaves the seat it was thrown from), but worth reopening because…_
