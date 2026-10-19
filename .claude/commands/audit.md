---
description: Full read-only multi-agent audit of Murlan — specialist lenses, adversarial verification, report, proposed tickets.
---
# Murlan — full-spectrum audit (multi-agent)

Use a workflow: this prompt asks for multi-agent orchestration. Run the `Workflow` tool against
`.claude/workflows/audit.mjs` (Step 2). This is a **read-only audit**. It produces a verified
report and proposes tickets. It changes no code.

What it must deliver:
- **Verified findings.** Each finding points at a line, names a concrete failure, and has survived
  a skeptic who saw only the claim and refutes what it cannot confirm. A finding a test can reach
  is **proven** only by a failing test that a second agent, blind to why it was written, re-ran;
  the rest stay **upheld**, and the report says which is which. Ten true findings are worth more
  than a hundred plausible ones.
- **Polish opportunities** from the `polish` lens: animation, sound, haptics and effects. These are
  proposals rather than defects, so they are judged on value and on whether they can be built.
- **An infrastructure recommendation** from the `infra` lens: where to host now that Replit is
  gone, and what the EAS build path costs. Every price in it is re-checked against its source.

## Step 1 — Preflight (inline)

1. Pin the checkout and the commit, from the checkout you are in:
   `git fetch origin && git rev-parse --show-toplevel origin/main` → `repo`, then `sha`.
2. Load the open tracker, so that known issues come back marked `tracked`:
   `node tools/loop/tracker.mjs list` (every open issue, as JSON `number` and `title`)
   → `openIssues`.
3. Check for peers with `git worktree list` and look at free RAM. Audit agents are read-only, so a
   live peer does not block the run — rule 2 still applies, and that matters more with another
   session sharing the machine.
4. `webUrl`: the URL of a web build that is **already** being served, or `null`. Do not start a
   build for the audit.
5. `scratch`: a new, empty directory outside every checkout, for the reproductions the audit
   writes: `C:/Users/roton/murlan-plans/audit-<first 8 of sha>/`, with a `proofs/` folder in it.
6. The tool layer: `node tools/audit/staticLayer.mjs --repo <repo> --out <scratch>/alerts.json`
   runs dependency-cruiser, knip, jscpd and reads CodeQL's open alerts on main. Its JSON is
   `staticLayer`. A tool listed in `failed` is reported as a coverage gap, never read as clean.

**Done when:** you hold `repo`, `sha`, `openIssues`, `webUrl`, `scratch` and `staticLayer`.

## Step 2 — Run the workflow

Call `Workflow` with `scriptPath: ".claude/workflows/audit.mjs"` and pass
`args: { repo, sha, openIssues, webUrl, scratch, staticLayer }` as a real JSON object, not a
JSON-encoded string. `lenses: [...]` limits the run to those lens keys. Follow progress in
`/workflows`. If a run dies, resume it with `resumeFromRunId`; do not restart it.

**Done when:** it returns `{ report, confirmed, opportunities, infra, refuted, failedLenses,
coverage, dismissedAlerts, judged, record }`.

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

4. **Record the run.** Append `record`, with today's date and `"kind": "audit"`, as one JSON line
   to `C:/Users/roton/murlan-plans/audit-runs.jsonl`. When an issue filed from an audit is later
   closed as not a defect, that is the audit's precision, read against this line.

**Done when:** your final message contains:
- the artifact link;
- the numbers of the issues you filed;
- every failed lens;
- every finding `docs/agents/RULES.md` rule 36 applies to.

## Calibration — how many known defects the audit finds

Run this instead of Steps 2–3 when the owner asks to calibrate the audit, and after any change to
`.claude/workflows/audit.mjs` that could change what it finds.

1. `node tools/audit/plantDefects.mjs --repo <main checkout> --sha <sha> --into
   C:/Users/roton/murlan-calibration/<first 8 of sha> --count 10` reverts the production half of up
   to ten past `bug` fixes into a detached checkout and prints its `repo`, `sha` and `record` file.
   The record names each planted defect; never pass it, or its path, to the workflow.
2. Run Step 1 items 5–6 and Step 2 against that checkout: its `repo` and `sha`, `openIssues: []`,
   `webUrl: null`, and `lenses` set to every lens except `polish` and `infra`. Add `--skip codeql`
   to the tool layer: CodeQL's alerts are main's lines, not the planted tree's.
3. Write the result's `judged` to `<scratch>/judged.json`, then
   `node tools/audit/plantDefects.mjs --score <record file> --judged <scratch>/judged.json`.
   `recall` is the share of planted defects a kept finding landed on; `refuted` counts the ones a
   skeptic or a passing reproduction talked the audit out of.
4. Append `record` plus the score, with today's date and `"kind": "calibration"`, to
   `C:/Users/roton/murlan-plans/audit-runs.jsonl`. File no tickets: these defects were planted.
5. From the main checkout, `npm run worktrees:remove -- <the calibration checkout>` (rule 39).

## Owner context the code cannot tell you

- Murlan is **not live**. There are no real accounts and no player data to preserve.
- The owner tests on **iOS, on a build of the app itself**. Chromium evidence about native rendering is only an
  inference.
- The quality bar is `docs/FEEL-BAR.md`. The prototype is the floor; top mobile card games
  and casino games are the ceiling.
- The priority order is stability first, then design.
- **The Replit subscription has ended.** The owner wants a more mature host: free at the start,
  with reasonable costs as it grows.

