/**
 * PreToolUse guard for Bash. Reads the tool call on stdin, blocks a command only when a correct
 * alternative always exists, and says what to run instead.
 *
 * Blocked:
 *   git add -A / . / --all / -u      sessions share an index; a bare add absorbs another session's work
 *                                    (allowed on pathspecs inside the current .worktrees/agent-N)
 *   git checkout <path> / restore / reset --hard / clean -f / stash drop   discard uncommitted work
 *   git worktree remove --force, rm -r .worktrees/…   delete through, or leave behind, a node_modules junction
 *   git push … main                  lands code with no CI
 *   a loop session's push anywhere but its own agent/<LOOP_TICKET>- branch
 *   find / …                         a filesystem sweep; resolve packages with require.resolve instead
 *   gh pr merge                      merges an UNSTABLE (incl. queued) pull request on the spot
 *   a rerun of a run it cannot name, or a loop session's second rerun of one
 *
 * Every rule reads the same parsed commands (`commands()`), never the raw text: a rule that matches
 * one spelling is passed by `git -C d add -A`, `X=1 git …`, `do git …` or `bash -c '…'`.
 *
 * Registered for both Bash and PowerShell in .claude/settings.json: the same `git` runs from
 * either, so guarding one shell only moves the mistake to the other.
 *
 * Exit 0 allows. Exit 2 blocks and returns the message on stderr to the agent.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { apiMethod, readIssue, TRUSTED_SELECT, untrustedRead } from "./brief.mjs";
import { locateRun } from "./loop-derive.mjs";
import { readLine } from "./loop-stream.mjs";
import { commands, has, literal, literalAssignments, loopBodies, MOVES, operands, toNative, withoutQuotedBodies } from "./shell.mjs";

/** A failure's first line — enough to name it on stderr without dumping a stack there. */
const firstLine = (err) => String(err?.message ?? err).split("\n")[0];

const HTTP_CLIENT = /^(gh|curl|wget|invoke-restmethod|invoke-webrequest|irm|iwr)$/;

/** The only `gh run rerun` flags that consume the token after them. */
const TAKES_A_VALUE = /^(-j|--job|-R|--repo)$/;
const JOB_FLAG = /^(?:--job|-j)$/;

/**
 * What one `gh run rerun` would re-dispatch: a run, a single job, or — when the id is a
 * variable, or absent, or something this cannot read — nothing identifiable.
 *
 * A job id is not a run id: `gh run view <job-id>` answers 404, so reading one as the other
 * resolves to nothing and waves through a second rerun of the job it names.
 */
function target(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const inlineJob = /^(?:--job|-j)=(.+)$/.exec(tokens[i]);
    if (inlineJob) return { job: inlineJob[1] };
    if (TAKES_A_VALUE.test(tokens[i])) {
      if (JOB_FLAG.test(tokens[i])) return tokens[i + 1] ? { job: tokens[i + 1] } : {};
      i += 1;
      continue;
    }
    if (tokens[i].startsWith("-")) continue;
    return /^\d+$/.test(tokens[i]) ? { run: tokens[i] } : {};
  }
  return {};
}

/** The run or job this command would re-dispatch, or null when it reruns nothing. */
function rerunOf(c) {
  if (c.cmd === "gh" && c.args[0] === "run" && c.args[1] === "rerun") return target(c.args.slice(2));
  const rest = HTTP_CLIENT.test(c.cmd) && /actions\/(runs|jobs)\/([^\s/?]+)\/rerun/i.exec(c.args.join(" "));
  if (!rest) return null;
  if (!/^\d+$/.test(rest[2])) return {};
  return rest[1].toLowerCase() === "jobs" ? { job: rest[2] } : { run: rest[2] };
}

/**
 * The run a target belongs to, as `{ workflowName, attempt }`. Throws when `gh` cannot say — network, auth, rate limit —
 * and leaves that to `check()`'s wrapper, which is the one place deciding to allow and saying
 * why, rather than this function choosing to allow silently.
 *
 * Allowing on that failure is deliberate: `gh` is also how the rerun would be dispatched, so a
 * guard that blocked here would forbid the honest path and protect nothing. That reasoning
 * covers a `gh` which cannot answer — never a question this asked wrongly, which is why an
 * unreadable id is refused before it gets here rather than resolved to null.
 */
function askGitHub({ run, job }) {
  const which = job ? [`--job=${job}`] : [run];
  return JSON.parse(
    execFileSync("gh", ["run", "view", ...which, "--json", "workflowName,attempt"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
}

/** Git as the discard rule asks it, from the directory the tool call runs in. */
export function gitAt(base) {
  const quietly = (args, dir) => {
    try {
      execFileSync("git", args, { cwd: resolve(base, dir ?? "."), stdio: "ignore", timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  };
  const answer = (args, dir) => {
    try {
      return execFileSync("git", args, { cwd: resolve(base, dir ?? "."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 }).trim();
    } catch {
      return null;
    }
  };
  return {
    branch: (dir) => answer(["symbolic-ref", "--short", "-q", "HEAD"], dir),
    pushTarget: (dir) => answer(["rev-parse", "--abbrev-ref", "@{push}"], dir),
    isRef: (arg, dir) => quietly(["rev-parse", "--verify", "-q", `${arg}^{commit}`], dir),
    // A git error reads as "not clean", so it blocks.
    pathsClean: (paths, dir) => quietly(["diff", "--quiet", "HEAD", "--", ...paths], dir),
    unmerged: (paths, dir) => {
      const conflicted = new Set((answer(["diff", "--name-only", "--relative", "--diff-filter=U"], dir) ?? "").split("\n").filter(Boolean));
      return paths.length > 0 && paths.every((p) => conflicted.has(p.replaceAll("\\", "/").replace(/^\.\//, "")));
    },
    top: (dir) => answer(["rev-parse", "--show-toplevel"], dir),
    cwd: (dir) => resolve(base, dir ?? "."),
    onTicket: () => {
      const run = locateRun(base);
      return Boolean(run.ticket || run.ambiguous);
    },
  };
}

const CHANNELS = /^(ready-for-human|noticed)$/;
const AGENT_WORK = /^(ready-for-agent|ci-flake|main-red)$/;

/** Every label the flags name, `--flag a,b` and `--flag=a,b` alike. */
function labelsOf(args, flags) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const eq = /^(--[\w-]+)=(.*)$/.exec(args[i]);
    if (eq && flags.includes(eq[1])) out.push(...eq[2].split(","));
    else if (flags.includes(args[i])) out.push(...(args[++i] ?? "").split(","));
  }
  return out.map((l) => l.trim());
}

/** The labels a `gh api` call's `labels`/`labels[]` fields carry. */
function apiLabels(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const joined = /^--(?:raw-)?field=(.*)$/.exec(args[i])?.[1];
    const value = joined ?? (/^(-f|-F|--field|--raw-field)$/.test(args[i]) ? (args[++i] ?? "") : "");
    const field = /^labels(?:\[\])?=(.*)$/.exec(value);
    if (field) out.push(...field[1].split(","));
  }
  return out.map((l) => l.trim());
}

function filesAgentWork(c) {
  if (c.cmd !== "gh") return false;
  const fresh = (labels) => labels.some((l) => AGENT_WORK.test(l)) || !labels.some((l) => CHANNELS.test(l));
  if (c.args[0] === "api" && apiMethod(c.args) !== "GET") {
    // `--input` labels are in a file this cannot read; `gh issue create|edit` says them where it can.
    const unseen = c.args.includes("--input");
    if (has(c.args, /(?:^|\/)issues$/)) return unseen || fresh(apiLabels(c.args));
    if (has(c.args, /\/issues\/\d+\/labels$/)) return unseen || apiLabels(c.args).some((l) => AGENT_WORK.test(l));
    return has(c.args, /\/issues\/\d+$/) && apiLabels(c.args).some((l) => AGENT_WORK.test(l));
  }
  if (c.args[0] !== "issue") return false;
  if (c.args[1] === "edit") return labelsOf(c.args, ["--add-label"]).some((l) => AGENT_WORK.test(l));
  return c.args[1] === "create" && fresh(labelsOf(c.args, ["--label", "-l"]));
}

/**
 * Whether this loop session is on the implement route, judged by its own phase: `LOOP_PHASE` when
 * the supervisor resumed it past A, else the markers in its transcript, since triage and wayfinder
 * never report past A. Only with no transcript to read does a standing ticket worktree decide.
 */
export function implementRoute(env, transcriptPath, standing = () => false, read = (p) => readFileSync(p, "utf8")) {
  if (/^[B-G]$/.test(env.LOOP_PHASE ?? "")) return true;
  let text;
  try {
    text = read(transcriptPath);
  } catch (err) {
    process.stderr.write(`guard-bash: cannot read this session's transcript (${firstLine(err)}); judging its route by the worktrees standing.\n`);
    return standing();
  }
  return text.split("\n").some((line) => line.includes("PHASE ") && /^[B-F]$/.test(readLine(line)?.letter ?? ""));
}

/** A ticket's worktree has an index of its own, so `-A` there can absorb no other session's work. */
function addsInsideOwnWorktree(c, repo) {
  const top = repo.top(c.dir);
  if (!top || !/[\\/]\.worktrees[\\/]agent-\d+$/.test(top)) return false;
  const dash = c.args.indexOf("--");
  const end = dash < 0 ? c.args.length : dash;
  const paths = [...c.args.slice(1, end).filter((a) => !a.startsWith("-")), ...c.args.slice(end + 1)];
  return (
    paths.length > 0 &&
    paths.every((p) => {
      if (p.startsWith(":")) return false;
      const rel = relative(resolve(top), resolve(repo.cwd(c.dir), p));
      return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
    })
  );
}

const pollsARun = (c) =>
  c.cmd === "gh" &&
  ((c.args[0] === "run" && /^(view|list)$/.test(c.args[1] ?? "")) ||
    (c.args[0] === "pr" && /^(checks|view|status)$/.test(c.args[1] ?? "")) ||
    (c.args[0] === "api" && /actions\/runs|check-runs/.test(c.args.join(" "))));

/**
 * `git checkout` discards when an operand is a path rather than a ref. Naming a source before
 * `--` is the documented way back, so it passes once those paths hold nothing uncommitted.
 */
function checkoutDiscards(rest, c, repo) {
  const dash = rest.indexOf("--");
  const before = dash < 0 ? rest : rest.slice(0, dash);
  const paths = dash < 0 ? [] : rest.slice(dash + 1);
  if (has(before, /^(-f|--force|--pathspec-from-file(=.*)?)$/)) return true;
  const named = operands(before, /^(-b|-B|--orphan)$/);
  const branching = has(before, /^(-b|-B|--orphan|-t|--track(=.*)?|--detach|--orphan=.*)$/);
  if (paths.length && has(before, /^--(ours|theirs)$/) && repo.unmerged(paths, c.dir)) return false;
  if (paths.length) return !named.length || !repo.pathsClean(paths, c.dir);
  return !branching && named.some((a) => !repo.isRef(a, c.dir));
}

function restoreDiscards(rest, c, repo) {
  const staged = has(rest, /^(--staged|-S[A-Za-z]*)$/);
  const worktree = has(rest, /^(--worktree|-[A-Za-z]*W[A-Za-z]*)$/);
  if (staged && !worktree) return false;
  const source = has(rest, /^(-s|--source|--source=.*)$/);
  const paths = operands(rest, /^(-s|--source)$/);
  return !source || !paths.length || !repo.pathsClean(paths, c.dir);
}

/** `git show <rev>:<path> > <path>` over a tracked file with uncommitted work: the same discard as a checkout. */
function redirectRestores(c, repo, vars, moved) {
  const blob =
    c.cmd === "git" &&
    (c.args[0] === "show" || (c.args[0] === "cat-file" && has(c.args, /^(blob|-p)$/))) &&
    c.args.find((a) => /^[^-][^:]*:./.test(a));
  if (!blob || !c.out?.length) return false;
  const source = blob.slice(blob.indexOf(":") + 1);
  return c.out.some((raw) => {
    const target = raw.replace(/\$\{?(\w+)\}?/g, (m, v) => c.env[v] ?? vars[v] ?? m);
    if (target.includes("$")) return raw === source;
    if (moved && !isAbsolute(target)) return true;
    const abs = resolve(repo.cwd(null), toNative(target));
    const top = repo.top(c.dir);
    const rel = top && relative(resolve(top), abs);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return false;
    const inGit = relative(repo.cwd(c.dir), abs);
    return !repo.unmerged([inGit], c.dir) && !repo.pathsClean([inGit], c.dir);
  });
}

function discards(c, repo) {
  if (c.cmd !== "git") return false;
  const [verb, ...rest] = c.args;
  switch (verb) {
    case "checkout":
      return checkoutDiscards(rest, c, repo);
    case "restore":
      return restoreDiscards(rest, c, repo);
    case "reset":
      return has(rest, /^--hard$/);
    case "clean":
      return has(rest, /^(-[A-Za-z]*f[A-Za-z]*|--force)$/) && !has(rest, /^(-[A-Za-z]*n[A-Za-z]*|--dry-run)$/);
    case "switch":
      return has(rest, /^(--discard-changes|-f|--force)$/);
    case "stash":
      return rest[0] === "drop" || rest[0] === "clear";
    default:
      return false;
  }
}

const PUSH_TAKES_A_VALUE = /^(-o|--push-option|--repo|--receive-pack|--exec)$/;

function pushesMain(c, repo) {
  if (c.cmd !== "git" || c.args[0] !== "push") return false;
  const isMain = (ref) => /^(refs\/heads\/)?main$/.test(ref);
  const refs = operands(c.args.slice(1), PUSH_TAKES_A_VALUE).slice(1);
  if (!refs.length) {
    const target = repo.pushTarget(c.dir);
    return target ? /^[^/]+\/main$/.test(target) : repo.branch(c.dir) === "main";
  }
  return refs.some((ref) => {
    const dest = ref.replace(/^\+/, "").split(":").pop();
    return /^(HEAD|@)$/.test(dest) ? repo.branch(c.dir) === "main" : isMain(dest);
  });
}

/** The ticket the supervisor spawned this session for, or null when its env names none. */
const loopTicket = () => (/^\d+$/.test(process.env.LOOP_TICKET ?? "") ? process.env.LOOP_TICKET : null);

/**
 * A push, or a ref write through the API, landing anywhere but `agent/<ticket>-…`, named by an
 * explicit `src:dst`. A delete names the branch alone, and only its own.
 */
function pushesElsewhere(c, ticket) {
  if (c.cmd === "gh" && c.args[0] === "api" && has(c.args, /\/git\/refs\b/)) return true;
  if (c.cmd !== "git" || c.args[0] !== "push") return false;
  if (ticket === null || has(c.args, /^(--all|--mirror|--tags|--prune)$/)) return true;
  const own = new RegExp(`^(refs/heads/)?agent/${ticket}-`);
  const refs = operands(c.args.slice(1), PUSH_TAKES_A_VALUE).slice(1);
  if (!refs.length) return true;
  if (has(c.args, /^(--delete|-d)$/)) return refs.some((ref) => !own.test(ref) || ref.includes(":"));
  return refs.some((ref) => {
    const dst = ref.replace(/^\+/, "").split(":")[1];
    return dst === undefined || !own.test(dst);
  });
}

function deletesWorktree(c) {
  if (!has(c.args, /(^|[\\/])\.worktrees([\\/]|$)/)) return false;
  if (c.cmd === "rm") return has(c.args, /^(-[A-Za-z]*[rR][A-Za-z]*|--recursive)$/);
  if (/^(remove-item|ri|del|erase|rmdir|rd)$/.test(c.cmd)) return has(c.args, /^(-r(e(c(u(r(s(e)?)?)?)?)?)?(:\S*)?|\/s)$/i);
  return false;
}

let playwrightScripts = null;
function runsPlaywrightScript(name) {
  if (playwrightScripts === null) {
    try {
      const { scripts = {} } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
      playwrightScripts = new Set(Object.keys(scripts).filter((k) => /\bplaywright\s+test\b/.test(scripts[k])));
    } catch {
      playwrightScripts = new Set();
    }
  }
  return playwrightScripts.has(name);
}

function runsPlaywright(c) {
  if (c.cmd === "playwright") return c.args[0] === "test";
  const operands = c.args.filter((a) => !a.startsWith("-"));
  if (c.cmd === "npx") return /^(@playwright\/test|playwright)$/.test(operands[0] ?? "") && operands[1] === "test";
  if (c.cmd === "npm") {
    const run = operands.findIndex((a) => a === "run" || a === "run-script");
    return run >= 0 && runsPlaywrightScript(operands[run + 1]);
  }
  return false;
}

const RULES = [
  {
    // A bare `.` after `--` is a real pathspec and is left alone.
    test: (c, { repo, moved }) =>
      c.cmd === "git" &&
      c.args[0] === "add" &&
      (has(c.args, /^(-A|--all|-u|--update)$/) || (!c.args.includes("--") && c.args.includes("."))) &&
      (moved || !addsInsideOwnWorktree(c, repo)),
    message:
      "git add -A/./--all/-u is blocked: this checkout is shared, and a bare add stages another " +
      "session's in-flight edits into your commit. Stage by pathspec instead:\n" +
      "  git add -- path/to/file another/file\n" +
      "Inside your own .worktrees/agent-N, `git add -A <dir…>` is allowed when every path is " +
      "below its root.\n" +
      "Check what you are about to stage with `git status --short` first.",
  },
  {
    test: (c, { repo, vars, moved }) => discards(c, repo) || redirectRestores(c, repo, vars, moved),
    message:
      "This git command is blocked: checkout of a path, restore, reset --hard, clean -f, " +
      "`git show <rev>:<path> > <path>` (the same restore by redirect), " +
      "switch --discard-changes and stash drop/clear all throw away uncommitted or stashed work — " +
      "including a fix you have not committed yet, or a peer's stash on the shared stack. This " +
      "has cost real work four times.\n" +
      "Undoing a seeded defect? Reverse it with the Edit tool — the same replacement backwards.\n" +
      "Switching branch? `git switch <branch>` refuses rather than discarding.\n" +
      "A redirect after a `cd` cannot be placed: name the target by absolute path, or `git -C <dir>` instead of the `cd`.\n" +
      "Resolving a merge or rebase conflict? `git checkout --ours|--theirs -- <path>` is allowed on a conflicted path.\n" +
      "Really want a file back from a commit? Commit your work first, then name the source:\n" +
      "  git checkout HEAD -- path/to/file\n" +
      "Confirm with `git status --short` and `git diff` afterwards.",
  },
  {
    // Measured, not theorised: a recursive delete of a worktree whose node_modules is a junction
    // deletes through it into the target and exits 0. `worktrees:remove` detaches the link first.
    test: (c) =>
      deletesWorktree(c) ||
      (c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "remove" && has(c.args, /^(--force|-f+)$/)),
    message:
      "Deleting a worktree by force is blocked: if its node_modules is a junction, " +
      "rm -r, Remove-Item -Recurse and, on Git for Windows before 2.54.0, git worktree remove " +
      "--force delete through the link into the shared install and still exit 0. That is how " +
      "C:\\Users\\roton\\murlan\\node_modules was emptied. From 2.54.0 git spares the install " +
      "but leaves the junction standing in an unregistered directory, for the next rm -r to follow.\n" +
      "Use the script that detaches the link first:\n" +
      "  npm run worktrees:remove -- .worktrees/<name>\n" +
      "Better still, do not create the junction: a worktree nested inside the checkout already " +
      "resolves up to the parent's node_modules on its own.",
  },
  {
    test: (c, { repo }) => pushesMain(c, repo),
    message:
      "Pushing to main is blocked: it lands code no CI run has judged (RULES.md rule 12).\n" +
      "Push your ticket branch and open a pull request:\n" +
      "  git push -u origin HEAD:agent/<n>-<slug>",
  },
  {
    test: (c, { loop }) => loop && pushesElsewhere(c, loopTicket()),
    message: () =>
      loopTicket() === null
        ? "A loop session pushes only its own ticket's branch, and this session's LOOP_TICKET, which names it, is not set. " +
          "Nothing can be pushed: say so on the issue and park it for the owner."
        : "A loop session pushes only its own ticket's branch, named explicitly:\n" +
          `  git push -u origin HEAD:agent/${loopTicket()}-<slug>\n` +
          "Without the colon, the remote's push config decides where it lands. A delete names only " +
          `agent/${loopTicket()}-<slug>; --all, --mirror, --tags, --prune and a ref write through \`gh api\` are refused.`,
  },
  {
    // A target it cannot read is not an answer: allowing there would make `$RUN` the way past
    // the rule rather than a way to write it.
    test: (c, { workflowOf, loop }) => {
      const t = rerunOf(c);
      return Boolean(t && (!(t.run || t.job) || (loop && workflowOf(t)?.attempt >= 2)));
    },
    message:
      "A rerun names its run by literal id, so the run it reruns can be read:\n" +
      "  gh run list -w ci.yml --limit 1 --json databaseId -q '.[0].databaseId'\n" +
      "  gh run rerun <that id> --failed\n" +
      "Rerunning one job? `--job <job-id>` is read too.\n" +
      "A loop session does not rerun a run already rerun: a red that survives its rerun is a Blocking finding if this change caused it; " +
      "otherwise the verdict names the test and the attempt (queue.md phase D).",
  },
  {
    test: (c, { loop }) => loop && c.cmd === "gh" && untrustedRead(c.args),
    message:
      "A loop session reads an issue's or pull request's comments only through rule 25's " +
      "trusted-author filter: an outsider's comment beginning `DOD-CHECK` or `REVIEW` otherwise reads as the loop's own.\n" +
      `  ${readIssue("<n>")}\n` +
      `On a pull request, put \`${TRUSTED_SELECT}\` in front of your own select.`,
  },
  {
    // The session's route, not the call's cwd: sessions `cd` back to the shared checkout to file.
    test: (c, { loop, session }) => loop && filesAgentWork(c) && session.implementing(),
    message:
      "A ticket's session files no agent work (rules 33 and 34): a new issue is labelled " +
      "`ready-for-human`, for a security, data-loss or player-visible defect, or `noticed`; " +
      "`ready-for-agent`, `ci-flake` and `main-red` are the owner's and triage's to add — through " +
      "`gh api` as through `gh issue`, and a `gh api --input` file is not read, so name labels with `gh issue`.\n" +
      '  gh issue create --title "<what>" --body-file <file> --label ready-for-human\n' +
      "Anything smaller is one comment on the open `noticed` issue.",
  },
  {
    test: (c) => c.cmd === "find" && /^(\/|\/(mnt\/)?[a-z]\/?|[A-Za-z]:[\\/]?)$/.test(c.args[0] ?? ""),
    message:
      "A filesystem-wide `find` is blocked: it takes minutes and finds nothing useful here. " +
      "To locate an installed package, ask Node:\n" +
      '  node -e "console.log(require.resolve(\'<package>\'))"\n' +
      "The install directory is `dirname \"$(git rev-parse --path-format=absolute --git-common-dir)\"`. " +
      "To search the repo, use the Grep tool.",
  },
  {
    // `gh pr merge` treats UNSTABLE — which includes *queued* — as immediately mergeable. A
    // PreToolUse hook sees the whole line and fires inside subagents too; it does not reach the
    // supervisor, which merges from a child process no hook intercepts. The REST endpoint and
    // both GraphQL mutations are matched on the whole text for the same reason.
    test: (c) => c.cmd === "gh" && c.args[0] === "pr" && c.args[1] === "merge",
    text: (t) =>
      /\bpulls\/[^\s"'/]+\/merge\b/.test(t) || /\bmergePullRequest\s*\(/.test(t) || /\benablePullRequestAutoMerge\s*\(/.test(t),
    message:
      "gh pr merge is not yours to merge. The pull request's CI has not been judged yet, and " +
      "`gh pr merge` merges an UNSTABLE pull request on the spot — UNSTABLE includes checks that " +
      "have not started. Two sessions merged a peer's pull request this way and the supervisor " +
      "then parked the ticket that had just landed.\n" +
      "tools/loop/queue-loop.mjs reads the run for this head, polls mergeability, and merges. " +
      "Push, open the pull request, and exit — that is the whole of phase E.\n" +
      "Blocked on a predecessor's change? Say so on the issue and park; do not merge it yourself.\n" +
      "Merging by hand is the owner's: ask them to run it, or run the loop.",
  },
  {
    test: (c) => c.piped && runsPlaywright(c),
    message:
      "Piping a Playwright run is blocked: a pipeline exits with its last command's code — tail's, " +
      "grep's, Select-String's — not the suite's, so a failing run reads as passed.\n" +
      "For short output, use the line reporter, unpiped:\n" +
      "  npx playwright test --config tests/e2e/playwright.config.ts one.spec.ts --reporter=line\n" +
      "Or send the output to a file outside the repo, then read its `N passed / N failed` line:\n" +
      "  npx playwright test ... > <file> 2>&1; echo \"exit $?\"",
  },
  {
    test: (c, { loop }) =>
      loop &&
      ((c.cmd === "sed" && has(c.args, /^(-[A-Za-z]*i|--in-place)/)) || (c.cmd === "perl" && has(c.args, /^-[A-HJ-Za-z]*i/))),
    message:
      "An in-place rewrite skips the Write|Edit hooks (RULES.md rule 44).\n" +
      "Change the file with the Edit or Write tool.",
  },
  {
    test: (c, { loop }) =>
      loop && c.cmd === "gh" &&
      ((c.args[0] === "run" && c.args[1] === "watch") || (c.args[0] === "pr" && c.args[1] === "checks" && has(c.args, /^--watch(=true)?$/))),
    line: (_parsed, runnable, { loop }) =>
      loop &&
      loopBodies(runnable).some((body) => {
        const inLoop = commands(body);
        return inLoop.some((c) => /^(sleep|start-sleep)$/i.test(c.cmd)) && inLoop.some(pollsARun);
      }),
    message:
      "Waiting on a run inside one call — gh run watch, gh pr checks --watch, or a sleep loop over gh run view/list, gh pr checks|view|status or gh api …actions/runs|check-runs — outlasts the Bash timeout on a device run: the call is killed and returns nothing.\n" +
      "Wait with `node tools/loop/await-run.mjs <run-id> [<run-id>…]`. It returns before the default Bash timeout; exit 3 means run the same command again.",
  },
];

/**
 * Wraps whatever resolves a rerun's workflow so a failure there — `gh` down, or a fault this
 * asked wrongly — allows and says so, instead of taking the whole hook down with it. Logged
 * once per call to `check()` even when a rule asks more than once for one command line.
 */
export function check(
  command,
  workflowOfRun = askGitHub,
  repo = gitAt(process.cwd()),
  loop = Boolean(process.env.LOOP_TURNS),
  session = { implementing: () => implementRoute(process.env, null, () => repo.onTicket()) },
) {
  const runnable = withoutQuotedBodies(command);
  const parsed = commands(runnable);
  const vars = literalAssignments(runnable);
  // The payload's cwd is where the line starts, not where a `cd` in it leaves git.
  const moved = parsed.some((c) => MOVES.test(c.cmd));
  let warned = false;
  const known = new Map();
  const workflowOf = (t) => {
    const key = JSON.stringify(t);
    if (!known.has(key)) known.set(key, lookUp(t));
    return known.get(key);
  };
  const lookUp = (t) => {
    try {
      return workflowOfRun(t);
    } catch (err) {
      if (!warned) {
        warned = true;
        process.stderr.write(
          `guard-bash: could not look up the rerun's workflow (${firstLine(err)}); allowing it unchecked.\n`
        );
      }
      return null;
    }
  };
  for (const rule of RULES) {
    if (rule.text?.(runnable) || rule.line?.(parsed, runnable, { loop }) || parsed.some((c) => rule.test(c, { workflowOf, repo, moved, vars: c.scope ? literal(c.scope) : vars, loop, session }))) {
      return typeof rule.message === "function" ? rule.message() : rule.message;
    }
  }
  return null;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  let command = "";
  let cwd = process.cwd();
  let transcript = null;
  try {
    const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
    command = (payload.tool_input ?? payload).command ?? "";
    cwd = payload.cwd ?? cwd;
    transcript = payload.transcript_path ?? null;
  } catch (err) {
    // unreadable payload must never block a tool call, but silence here is the other half of
    // the same bug the RULES above exist to catch — say what could not be checked.
    process.stderr.write(`guard-bash: could not read the tool call on stdin (${firstLine(err)}); allowing it.\n`);
    process.exit(0);
  }
  const repo = gitAt(cwd);
  const session = { implementing: () => implementRoute(process.env, transcript, () => repo.onTicket()) };
  const message = check(command, askGitHub, repo, Boolean(process.env.LOOP_TURNS), session);
  if (message) {
    process.stderr.write(message + "\n");
    process.exit(2);
  }
}
