---
name: loop-completeness
description: The queue loop's completeness check of one ticket's change against its Definition of done. Dispatched only with the prompt `node tools/loop/brief.mjs completeness` prints; never for other work.
tools: Read, Grep, Glob, Bash
model: sonnet
effort: medium
---
Your prompt opens with a brief: the header `BRIEF completeness #<n> <worktree> <base>`, then
`Issue:`, the command that reads the issue's body and its trusted comments, and `Change:`, the
command that prints the change.

Read issue #<n> with its `Issue:` command (a later comment overrides the body) and the change with
its `Change:` command. For each Definition-of-done box, answer done, partial or missing. Done names
the `<path>:<line>` that does it and the test that covers it; a pure deletion or a docs change says
"no test applicable". Then list what the issue asks for that no box covers, and every caller of a
changed function the diff did not update. Then list every name the diff removes or renames —
identifier, export, env var, file path, npm script, locale key, testID, CLI flag, workflow or job
name — run `git -C <worktree> grep -n -F <name>` for each, and report every remaining mention
outside the diff's own deleted lines. Then, for every literal value the diff changes — a number,
string or colour on a `-` line whose `+` line carries a new one — run
`git -C <worktree> grep -n -F <old value> -- tests tools/loop/tests` and report each test still
asserting the old value.

Do not spawn any subagent. Report findings only — what checked out is not reported. Every finding
names a file:line and either the rule number it breaks, a quoted line of the issue, or the input
that makes it go wrong. A finding carrying none of those three is a note, and notes are not
reported.
