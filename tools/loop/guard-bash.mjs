/**
 * PreToolUse guard for Bash. Reads the tool call on stdin, blocks a command only when a correct
 * alternative always exists, and says what to run instead.
 *
 * Blocked:
 *   git add -A / . / --all / -u      sessions share an index; a bare add absorbs another session's work
 *                                    (allowed on pathspecs inside the current .worktrees/agent-N)
 *   git checkout <path> / restore / reset --hard / clean -f / stash drop   discard uncommitted work
 *   git worktree remove --force, rm -r .worktrees/…   delete through a node_modules junction
 *   git push … main                  lands code with no CI
 *   find / …                         a filesystem sweep; resolve packages with require.resolve instead
 *   gh pr merge                      merges an UNSTABLE (incl. queued) pull request on the spot
 *   a device workflow rerun, or a dispatch anywhere but a ticket's own agent/<n>- branch
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

/** A failure's first line — enough to name it on stderr without dumping a stack there. */
const firstLine = (err) => String(err?.message ?? err).split("\n")[0];

const SHELL = /^(bash|sh|zsh|dash|pwsh|powershell|cmd|iex|invoke-expression)$/;
const PIPED_TO_SHELL = /^[^\n]*\|\s*(?:\S*[\\/])?(bash|sh|zsh|dash|pwsh|powershell|iex|invoke-expression)\b/i;
const WRAPPER = new Set(["env", "xargs", "time", "do", "then", "else", "elif", "if", "while", "until", "!", "exec", "nohup", "command", "sudo", "nice"]);
const WRAPPER_TAKES_A_VALUE = /^-(?:[IinPdLEsau]|-(?:max-args|max-procs|delimiter|replace|arg-file|unset))$/;
const GIT_TAKES_A_VALUE = /^(-C|-c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix)$/;
const GH_TAKES_A_VALUE = /^(-R|--repo|--hostname)$/;
const REDIRECT = /^\d*(?:[<>]+|&>>?)(\S*)$/;
const MAX_DEPTH = 5;

const commandName = (word) => (word ?? "").replace(/\\/g, "/").split("/").pop().replace(/\.(exe|cmd)$/i, "").toLowerCase();

/** Index of the `)` closing the `(` at `open`, or the end of the text. */
function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return text.length;
}

/**
 * The words of each simple command, quote-aware: a separator inside quotes is data, and a
 * `$( … )` anywhere, quoted or not, is a command of its own. Backslash is literal (PowerShell and
 * Windows paths) except before a quote or a newline.
 */
function segments(text, depth) {
  const out = [];
  let words = [];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
      continue;
    }
    if (ch === "$" && text[i + 1] === "(") {
      const end = closing(text, i + 1);
      if (depth < MAX_DEPTH) out.push(...segments(text.slice(i + 2, end), depth + 1));
      word = (word ?? "") + text.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === "\\" && /["'\n]/.test(text[i + 1] ?? "")) {
      if (text[i + 1] === "\n") endWord();
      else word = (word ?? "") + text[i + 1];
      i += 1;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      word ??= "";
    } else if (ch === "$" && text[i + 1] === "{") {
      const end = text.indexOf("}", i);
      const stop = end < 0 ? text.length : end;
      word = (word ?? "") + text.slice(i, stop + 1);
      i = stop;
    } else if (ch === "`" && text[i + 1] === "\n") {
      endWord();
      i += 1;
    } else if (ch === "&" && (/[<>]/.test(text[i - 1] ?? "") || text[i + 1] === ">")) {
      word = (word ?? "") + ch;
    } else if (/[;&|\n(){}`]/.test(ch)) {
      if (ch === "|" && text[i - 1] !== "|" && text[i + 1] !== "|") words.piped = true;
      endSegment();
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      word = (word ?? "") + ch;
    }
  }
  endSegment();
  return out;
}

/**
 * One segment as `{ cmd, env, dir, args, piped }`: leading assignments, wrappers and redirections
 * gone, a shell's `-c` body parsed in its place, and git's or gh's global options taken off so
 * `args[0]` is the verb. `env` holds the leading assignments; `dir` is git's last `-C`; `piped`
 * means its output feeds a `|`.
 */
function normalize(words, depth) {
  const env = {};
  let i = 0;
  for (; i < words.length; i++) {
    const assign = /^([A-Za-z_]\w*)=([\s\S]*)$/.exec(words[i]);
    if (assign) {
      env[assign[1]] = assign[2];
    } else if (REDIRECT.test(words[i])) {
      if (!REDIRECT.exec(words[i])[1]) i += 1;
    } else if (WRAPPER.has(commandName(words[i]))) {
      while (words[i + 1]?.startsWith("-")) i += WRAPPER_TAKES_A_VALUE.test(words[i + 1]) ? 2 : 1;
    } else {
      break;
    }
  }
  if (i >= words.length) return [];
  const cmd = commandName(words[i]);
  const rest = words.slice(i + 1);

  if (SHELL.test(cmd) && depth < MAX_DEPTH) {
    const herestring = rest.indexOf("<<<");
    const flag = rest.findIndex((a) => /^(-c|-command|\/c|\/k)$/i.test(a));
    const body =
      herestring >= 0
        ? rest[herestring + 1]
        : flag < 0
          ? rest[0] && !rest[0].startsWith("-") && /^(iex|invoke-expression)$/.test(cmd) ? rest.join(" ") : null
          : /^(pwsh|powershell|cmd)$/.test(cmd)
            ? rest.slice(flag + 1).join(" ")
            : rest[flag + 1];
    if (body) return commands(body, depth + 1).map((c) => ({ ...c, piped: c.piped || words.piped === true }));
  }

  const args = [];
  for (let j = 0; j < rest.length; j++) {
    const redirect = REDIRECT.exec(rest[j]);
    if (redirect) j += redirect[1] ? 0 : 1;
    else args.push(rest[j]);
  }
  let dir = null;
  const globals = cmd === "git" ? GIT_TAKES_A_VALUE : cmd === "gh" ? GH_TAKES_A_VALUE : null;
  while (globals && args[0]?.startsWith("-")) {
    const takes = globals.test(args[0]);
    if (cmd === "git" && args[0] === "-C") dir = args[1] ?? dir;
    args.splice(0, takes ? 2 : 1);
  }
  return [{ cmd, env, dir, args, piped: words.piped === true }];
}

export function commands(text, depth = 0) {
  return segments(text, depth).flatMap((words) => normalize(words, depth));
}

/**
 * Blanks the bodies of here-strings and heredocs before any rule reads the command — unless the
 * body is fed to a shell, where it is the command.
 *
 * Their content is otherwise data — a commit message, a PR body, a doc — and a line inside one
 * begins at a line start like any other, so a rule would fire on prose *about* a command.
 * Blanked rather than deleted so nothing on either side is joined into a new match.
 */
export function withoutQuotedBodies(command) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  const lineBefore = (all, offset) => all.slice(all.lastIndexOf("\n", offset - 1) + 1, offset);
  const feedsShell = (before, after) => {
    const last = commands(before).pop();
    return (last && SHELL.test(last.cmd) && !has(last.args, /^[^-]/)) || PIPED_TO_SHELL.test(after);
  };
  return command
    .replace(/@(['"])([\s\S]*?)\1@/g, (m, _q, body, offset, all) =>
      feedsShell(lineBefore(all, offset), all.slice(offset + m.length)) ? `  ${body}  ` : blank(m)
    )
    .replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*\n)([\s\S]*?^\t*\2$)/gm, (m, _q, _tag, rest, body, offset, all) => {
      const opener = m.slice(0, m.length - rest.length - body.length);
      return blank(opener) + rest + (feedsShell(lineBefore(all, offset), rest) ? body : blank(body));
    });
}

/** Both device workflows are named for Maestro, and the iOS one's file is `ios.yml`. */
const DEVICE_WORKFLOW = /maestro|\bios\b/i;

/** `gh workflow run … --ref agent/<n>-…` (or `--ref=`, `-r`): a ticket dispatching on its own branch. */
function dispatchesOnTicketBranch(c) {
  const at = c.args.findIndex((a) => a === "-r" || a === "--ref");
  const ref = at >= 0 ? (c.args[at + 1] ?? "") : (c.args.find((a) => a.startsWith("--ref=")) ?? "").slice(6);
  return c.cmd === "gh" && c.args[0] === "workflow" && /^agent\/\d+-/.test(ref);
}
const HTTP_CLIENT = /^(gh|curl|wget|invoke-restmethod|invoke-webrequest|irm|iwr)$/;

/** The only `gh run rerun` flags that consume the token after them. */
const TAKES_A_VALUE = /^(-j|--job|-R|--repo)$/;
const JOB_FLAG = /^(?:--job|-j)$/;

/**
 * What one `gh run rerun` would re-dispatch: a run, a single job, or — when the id is a
 * variable, or absent, or something this cannot read — nothing identifiable.
 *
 * A job id is not a run id: `gh run view <job-id>` answers 404, so reading one as the other
 * resolves to nothing and waves through the ~25 minute simulator job it names.
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

/** The workflow this command dispatches, or null when it dispatches none. */
function dispatchOf(c) {
  if (c.cmd === "gh" && c.args[0] === "workflow" && c.args[1] === "run") {
    for (let i = 2; i < c.args.length; i++) {
      if (/^(-r|--ref|-f|--raw-field|-F|--field|-R|--repo)$/.test(c.args[i])) i += 1;
      else if (!c.args[i].startsWith("-")) return c.args[i];
    }
    return "";
  }
  const rest = HTTP_CLIENT.test(c.cmd) && /actions\/workflows\/([^\s/?]+)\/dispatches/i.exec(c.args.join(" "));
  return rest ? rest[1] : null;
}

/**
 * The workflow a target belongs to. Throws when `gh` cannot say — network, auth, rate limit —
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
  return (
    execFileSync("gh", ["run", "view", ...which, "--json", "workflowName", "-q", ".workflowName"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null
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
    top: (dir) => answer(["rev-parse", "--show-toplevel"], dir),
    cwd: (dir) => resolve(base, dir ?? "."),
  };
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

const has = (args, re) => args.some((a) => re.test(a));

/**
 * `git checkout` discards when an operand is a path rather than a ref. Naming a source before
 * `--` is the documented way back, so it passes once those paths hold nothing uncommitted.
 */
function checkoutDiscards(rest, c, repo) {
  const dash = rest.indexOf("--");
  const before = dash < 0 ? rest : rest.slice(0, dash);
  const paths = dash < 0 ? [] : rest.slice(dash + 1);
  if (has(before, /^(-f|--force|--pathspec-from-file(=.*)?)$/)) return true;
  const operands = [];
  let branching = false;
  for (let i = 0; i < before.length; i++) {
    if (/^(-b|-B|--orphan)$/.test(before[i])) {
      branching = true;
      i += 1;
    } else if (/^(-t|--track(=.*)?|--detach|--orphan=.*)$/.test(before[i])) {
      branching = true;
    } else if (!before[i].startsWith("-")) {
      operands.push(before[i]);
    }
  }
  if (paths.length) return !operands.length || !repo.pathsClean(paths, c.dir);
  return !branching && operands.some((a) => !repo.isRef(a, c.dir));
}

function restoreDiscards(rest, c, repo) {
  const staged = has(rest, /^(--staged|-S[A-Za-z]*)$/);
  const worktree = has(rest, /^(--worktree|-[A-Za-z]*W[A-Za-z]*)$/);
  if (staged && !worktree) return false;
  const paths = [];
  let source = false;
  for (let i = 0; i < rest.length; i++) {
    if (/^(-s|--source)$/.test(rest[i])) {
      source = true;
      i += 1;
    } else if (/^--source=/.test(rest[i])) {
      source = true;
    } else if (!rest[i].startsWith("-")) {
      paths.push(rest[i]);
    }
  }
  return !source || !paths.length || !repo.pathsClean(paths, c.dir);
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

function pushesMain(c, repo) {
  if (c.cmd !== "git" || c.args[0] !== "push") return false;
  const operands = [];
  for (let i = 1; i < c.args.length; i++) {
    if (/^(-o|--push-option|--repo|--receive-pack|--exec)$/.test(c.args[i])) i += 1;
    else if (!c.args[i].startsWith("-")) operands.push(c.args[i]);
  }
  const isMain = (ref) => /^(refs\/heads\/)?main$/.test(ref);
  const refs = operands.slice(1);
  if (!refs.length) {
    const target = repo.pushTarget(c.dir);
    return target ? /^[^/]+\/main$/.test(target) : repo.branch(c.dir) === "main";
  }
  return refs.some((ref) => {
    const dest = ref.replace(/^\+/, "").split(":").pop();
    return /^(HEAD|@)$/.test(dest) ? repo.branch(c.dir) === "main" : isMain(dest);
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
    test: (c, { repo }) => discards(c, repo),
    message:
      "This git command is blocked: checkout of a path, restore, reset --hard, clean -f, " +
      "switch --discard-changes and stash drop/clear all throw away uncommitted or stashed work — " +
      "including a fix you have not committed yet, or a peer's stash on the shared stack. This " +
      "has cost real work four times.\n" +
      "Undoing a seeded defect? Reverse it with the Edit tool — the same replacement backwards.\n" +
      "Switching branch? `git switch <branch>` refuses rather than discarding.\n" +
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
      "git worktree remove --force, rm -r and Remove-Item -Recurse delete through the link into " +
      "the shared install and still exit 0. That is how " +
      "C:\\Users\\roton\\murlan\\node_modules was emptied.\n" +
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
      "  git push -u origin agent/<n>-<slug>",
  },
  {
    // A numeric workflow id cannot be read, so it is treated as the device one.
    test: (c, { workflowOf }) => {
      const dispatched = dispatchOf(c);
      if (dispatched !== null) return (DEVICE_WORKFLOW.test(dispatched) || /^\d*$/.test(dispatched)) && !dispatchesOnTicketBranch(c);
      const t = rerunOf(c);
      return Boolean(t && (t.run || t.job) && DEVICE_WORKFLOW.test(workflowOf(t) ?? ""));
    },
    message:
      "The iOS and Android device workflows run only when a ticket dispatches them on its own branch, " +
      "and only when its work needs a device run:\n" +
      "  gh workflow run ios.yml --ref agent/<n>-<slug>\n" +
      "A red device run is diagnosed from its maestro-debug artifacts and dispatched again after a " +
      "change, never rerun.\n" +
      "Not a device workflow? Name it by its file (ci.yml), not a numeric id.",
  },
  {
    // The rule above allows a rerun once GitHub says the run is not a device one. A target it
    // cannot read is not an answer, and defaulting to allow there would make `$RUN` the way
    // past the rule rather than a way to write it.
    test: (c) => {
      const t = rerunOf(c);
      return Boolean(t && !t.run && !t.job);
    },
    message:
      "This rerun does not name a run this guard can look up, and a rerun it cannot identify " +
      "might be the ~25 minute device job.\n" +
      "Name the run by its literal id so the workflow can be read:\n" +
      "  gh run list -w ci.yml --limit 1 --json databaseId -q '.[0].databaseId'\n" +
      "  gh run rerun <that id> --failed\n" +
      "Rerunning one job? `--job <job-id>` is read too. Device runs are never rerun.",
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
];

/**
 * Wraps whatever resolves a rerun's workflow so a failure there — `gh` down, or a fault this
 * asked wrongly — allows and says so, instead of taking the whole hook down with it. Logged
 * once per call to `check()` even when a rule asks more than once for one command line.
 */
export function check(command, workflowOfRun = askGitHub, repo = gitAt(process.cwd())) {
  const runnable = withoutQuotedBodies(command);
  const parsed = commands(runnable);
  // The payload's cwd is where the line starts, not where a `cd` in it leaves git.
  const moved = parsed.some((c) => /^(cd|chdir|pushd|popd|set-location|sl|push-location)$/.test(c.cmd));
  let warned = false;
  const workflowOf = (t) => {
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
    if (rule.text?.(runnable) || parsed.some((c) => rule.test(c, { workflowOf, repo, moved }))) return rule.message;
  }
  return null;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  let command = "";
  let cwd = process.cwd();
  try {
    const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
    command = (payload.tool_input ?? payload).command ?? "";
    cwd = payload.cwd ?? cwd;
  } catch (err) {
    // unreadable payload must never block a tool call, but silence here is the other half of
    // the same bug the RULES above exist to catch — say what could not be checked.
    process.stderr.write(`guard-bash: could not read the tool call on stdin (${firstLine(err)}); allowing it.\n`);
    process.exit(0);
  }
  const message = check(command, askGitHub, gitAt(cwd));
  if (message) {
    process.stderr.write(message + "\n");
    process.exit(2);
  }
}
