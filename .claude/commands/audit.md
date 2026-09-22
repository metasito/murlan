---
description: Full read-only multi-agent audit of Murlan — specialist lenses, adversarial verification, report, proposed tickets.
---
# Murlan — full-spectrum audit (multi-agent)

Use a workflow: this prompt asks for multi-agent orchestration. Run the `Workflow` tool against
`.claude/workflows/audit.mjs` (Step 2). This is a **read-only audit**. It produces a verified
report and proposes tickets. It changes no code.

What it must deliver:
- **Verified findings.** Each finding points at a line, names a concrete failure, and has survived
  a skeptic whose job was to refute it. Ten true findings are worth more than a hundred plausible
  ones.
- **Polish opportunities** from the `polish` lens: animation, sound, haptics and effects. These are
  proposals rather than defects, so they are judged on value and on whether they can be built.
- **An infrastructure recommendation** from the `infra` lens: where to host now that Replit is
  gone, and whether leaving Expo Go for development builds is worth it. Every price in it is
  re-checked against its source.

## Step 1 — Preflight (inline)

1. Pin the commit:
   `git -C C:/Users/roton/murlan fetch origin && git -C C:/Users/roton/murlan rev-parse origin/main`
   → `sha`.
2. Load the open tracker, so that known issues come back marked `tracked`:
   `gh issue list --repo metasito/murlan --state open --limit 300 --json number,title --jq '[.[]|{n:.number,t:.title}]'`
   → `openIssues`.
3. Check for peers with `git worktree list` and look at free RAM. Audit agents are read-only, so a
   live peer does not block the run — rules 2 and 37 still bind what any agent runs while one is.
4. `webUrl`: the URL of a web build that is **already** being served, or `null`. Do not start a
   build for the audit.

**Done when:** you hold `sha`, `openIssues` and `webUrl`.

## Step 2 — Run the workflow

Call `Workflow` with `scriptPath: ".claude/workflows/audit.mjs"` and pass
`args: { sha, openIssues, webUrl }` as a real JSON object, not a JSON-encoded string. Follow
progress in `/workflows`. If a run dies, resume it with `resumeFromRunId`; do not restart it.

**Done when:** it returns `{ report, confirmed, opportunities, infra, refuted, failedLenses, coverage }`.

## Step 3 — Publish, then propose tickets

1. **Publish the report.** Load `artifact-design` and publish the report as one private HTML
   `Artifact`. It must contain the lens scorecard, the top findings, the cross-cutting classes,
   the polish roadmap, the infrastructure comparison and recommendation, the strengths, the
   refuted appendix and the coverage gaps. Add filters by
   lens and by severity. Give the owner the link.
2. **Ask which batches to file.** Show the proposed ticket batches: one per defect *class*,
   each with a title, a size and a one-line summary. Ask once, with `AskUserQuestion`.
3. **File the approved batches.**
   - Before writing a body, follow `docs/agents/issue-tracker.md` → *Writing an issue body an
     agent can execute*.
   - When labelling and filing, follow that file's *Labels* and *Recipes* sections.
   - Each body cites the audit SHA, every `path:line`, the failure scenario, and the check that
     would catch the next instance.
   - If a finding matches an open issue, comment on that issue instead of opening a new one.
   - A move off Replit (ADR-0006) is already tracked as `wayfinder:map` #1105 — comment findings
     onto it rather than filing a new map or a loose ticket.

**Done when:** your final message contains:
- the artifact link;
- the numbers of the issues you filed;
- every failed lens;
- every finding `docs/agents/RULES.md` rule 36 applies to.

## Owner context the code cannot tell you

- Murlan is **not live**. There are no real accounts and no player data to preserve.
- The owner tests on **iOS through Expo Go**. Chromium evidence about native rendering is only an
  inference.
- The quality bar is `docs/FEEL-BAR.md`. The prototype is the floor; top mobile card games
  and casino games are the ceiling.
- The priority order is stability first, then design.
- **The Replit subscription has ended.** The owner wants a more mature host: free at the start,
  with reasonable costs as it grows. The owner is open to leaving Expo Go for development builds
  if that unlocks real improvements to the game.

