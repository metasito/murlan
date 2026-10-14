/**
 * A command line as the simple commands it runs. Every guard and the stream reader read it through
 * this one parser, so a spelling one of them understands the others do too.
 */
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const SHELL = /^(bash|sh|zsh|dash|pwsh|powershell|cmd|iex|invoke-expression)$/;
const PIPED_TO_SHELL = /^[^\n]*\|\s*(?:\S*[\\/])?(bash|sh|zsh|dash|pwsh|powershell|iex|invoke-expression)\b/i;
const WRAPPER = new Set(["env", "xargs", "time", "do", "then", "else", "elif", "if", "while", "until", "!", "exec", "nohup", "command", "sudo", "nice"]);
const WRAPPER_TAKES_A_VALUE = /^-(?:[IinPdLEsau]|-(?:max-args|max-procs|delimiter|replace|arg-file|unset))$/;
const GIT_TAKES_A_VALUE = /^(-C|-c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix)$/;
const GH_TAKES_A_VALUE = /^(-R|--repo|--hostname)$/;
const REDIRECT = /^\d*(?:[<>]+|&>>?)(\S*)$/;
const MAX_DEPTH = 5;

const commandName = (word) => (word ?? "").replace(/\\/g, "/").split("/").pop().replace(/\.(exe|cmd)$/i, "").toLowerCase();

export const has = (args, re) => args.some((a) => re.test(a));

export const MOVES = /^(cd|chdir|pushd|popd|set-location|sl|push-location)$/;

/** The words of `args` that are neither a flag nor the value a flag matching `takesValue` consumes. */
export function operands(args, takesValue) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (takesValue.test(args[i])) i += 1;
    else if (!args[i].startsWith("-")) out.push(args[i]);
  }
  return out;
}

/** Git Bash spells `C:\x` as `/c/x` and its temp dir as `/tmp`; Node would read both as paths on the current drive. */
export const toNative = (p, platform = process.platform) =>
  platform === "win32"
    ? p.replace(/^\/tmp(?=\/|$)/, tmpdir().replace(/\\/g, "/")).replace(/^\/([A-Za-z])(\/|$)/, (_, d) => `${d.toUpperCase()}:/`)
    : p;

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
  let i = 0;
  let from = 0;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    words.span = [from, i];
    if (words.length) out.push(words);
    words = [];
    from = i + 1;
  };
  for (; i < text.length; i++) {
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

/** The command line a shell (or `iex`) is handed: its `-c` body, a here-string, or the rest of an `iex`. */
function shellBodyOf(cmd, rest) {
  const herestring = rest.indexOf("<<<");
  const flag = rest.findIndex((a) => /^(-c|-command|\/c|\/k)$/i.test(a));
  if (herestring >= 0) return rest[herestring + 1];
  if (flag < 0) return rest[0] && !rest[0].startsWith("-") && /^(iex|invoke-expression)$/.test(cmd) ? rest.join(" ") : null;
  return /^(pwsh|powershell|cmd)$/.test(cmd) ? rest.slice(flag + 1).join(" ") : rest[flag + 1];
}

/**
 * One segment as `{ cmd, env, dir, args, piped }`: leading assignments, wrappers and redirections
 * gone, a shell's `-c` body parsed in its place, and git's or gh's global options taken off so
 * `args[0]` is the verb. `env` holds the leading assignments; `dir` is git's last `-C`; `out` is
 * its stdout redirect targets; `piped` means its output feeds a `|`.
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
    } else if (commandName(words[i]) === "timeout") {
      while (words[i + 1]?.startsWith("-")) i += /^(-[sk]|--signal|--kill-after)$/.test(words[i + 1]) ? 2 : 1;
      i += 1;
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
    const body = shellBodyOf(cmd, rest);
    if (body) {
      const scope = { ...env, ...assignmentsIn(body) };
      return commands(body, depth + 1).map((c) => ({ ...c, scope: { ...scope, ...c.scope }, piped: c.piped || words.piped === true }));
    }
  }

  const args = [];
  const out = [];
  for (let j = 0; j < rest.length; j++) {
    const redirect = REDIRECT.exec(rest[j]);
    if (!redirect) {
      args.push(rest[j]);
      continue;
    }
    const target = redirect[1] || rest[j + 1] || "";
    if (/^[1&]?>/.test(rest[j]) && target && !target.startsWith("&")) out.push(target);
    j += redirect[1] ? 0 : 1;
  }
  let dir = null;
  const globals = cmd === "git" ? GIT_TAKES_A_VALUE : cmd === "gh" ? GH_TAKES_A_VALUE : null;
  while (globals && args[0]?.startsWith("-")) {
    const takes = globals.test(args[0]);
    if (cmd === "git" && args[0] === "-C") dir = args[1] ?? dir;
    args.splice(0, takes ? 2 : 1);
  }
  return [{ cmd, env, dir, args, out, piped: words.piped === true }];
}

export function commands(text, depth = 0) {
  // gh's own `{owner}`/`{repo}`/`{branch}` placeholders, or the braces split an endpoint in three.
  const spelled = depth === 0 ? text.replace(/\{(owner|repo|branch)\}/g, "$1") : text;
  return segments(spelled, depth).flatMap((words) => normalize(words, depth));
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

const ASSIGN = /^([A-Za-z_]\w*)=([\s\S]*)$/;
export const literal = (vars) => Object.fromEntries(Object.entries(vars).filter(([, v]) => /^[^\s$`]+$/.test(v ?? "")));

function assignmentsIn(text) {
  const vars = {};
  for (const w of segments(text, MAX_DEPTH)) {
    let i = 0;
    while (/^(do|then|else|elif|!)$/.test(w[i] ?? "")) i += 1;
    if (i < w.length && w.slice(i).every((x) => ASSIGN.test(x))) for (const x of w.slice(i)) vars[ASSIGN.exec(x)[1]] = ASSIGN.exec(x)[2];
  }
  return vars;
}

/**
 * `B=agent/12-x && … --ref $B`: literal assignments `commands()` drops. Only a bare `X=…` statement
 * sets one for the line; a child shell's own and prefix assignments are its scope (`normalize`).
 */
export const literalAssignments = (text) => literal(assignmentsIn(text));

/** Each command of the line, with the directory the `cd`s before it left the call in. */
export function located(command, cwd) {
  let at = cwd;
  const out = [];
  for (const c of commands(command)) {
    if (!MOVES.test(c.cmd)) out.push({ c, at });
    else {
      const to = c.args.find((a) => !a.startsWith("-"));
      if (to) at = resolve(at, toNative(to));
    }
  }
  return out;
}

const LOOP_KEYWORD = /^(for|foreach|foreach-object|while|until|%)$/i;
const headOf = (w) => w.find((x) => !/^(do|then|else|!)$/.test(x)) ?? "";

/**
 * The block braces between each segment and the next, as `[char, position]`. `segments()` splits on
 * every brace, so a bash brace expansion — `{1..48}`, `a{1,2}`: a pair with no space or separator
 * inside — is dropped here, or it would read as a PowerShell block opening before the `do`.
 */
function blockBraces(text, segs) {
  const gaps = segs.map((s, k) => {
    const out = [];
    for (let p = s.span[1]; p < (segs[k + 1]?.span[0] ?? text.length); p++) if (/[{}]/.test(text[p])) out.push([text[p], p]);
    return out;
  });
  const expansion = new Set();
  const open = [];
  for (const [ch, p] of gaps.flat()) {
    if (ch === "{") open.push(p);
    else if (open.length) {
      const o = open.pop();
      if (!/[\s;|&]/.test(text.slice(o + 1, p))) expansion.add(o).add(p);
    }
  }
  return gaps.map((g) => g.filter(([, p]) => !expansion.has(p)));
}

/** Where the loop opened by `segs[k]` ends: its matching `done`, or for PowerShell its matching `}`. */
function loopEnd(text, segs, k, braces) {
  let j = k;
  while (j < segs.length && !braces[j].some(([ch]) => ch === "{") && !(j > k && segs[j][0] === "do")) j += 1;
  if (j < segs.length && segs[j][0] === "do" && j > k) {
    let open = 1;
    for (; j < segs.length; j++) {
      if (LOOP_KEYWORD.test(headOf(segs[j]))) open += 1;
      if (segs[j][0] === "done" && --open === 0) return segs[j].span[1];
    }
    return text.length;
  }
  let depth = 0;
  for (; j < segs.length; j++) {
    for (const [ch, at] of braces[j]) {
      if (ch === "{") depth += 1;
      if (ch !== "}" || --depth > 0) continue;
      const cond = segs[j + 1];
      if (segs[k][0] !== "do" || !/^(while|until)$/i.test(cond?.[0] ?? "")) return at + 1;
      const paren = text.indexOf("(", cond.span[0]);
      return paren < 0 ? text.length : closing(text, paren) + 1;
    }
  }
  return text.length;
}

/**
 * Each loop's own text, keyword to end, in shell and `$( … )` bodies too. Spans come from a parse
 * that keeps `$( … )` whole, so only separators lie between two segments' spans.
 */
export function loopBodies(text, depth = 0) {
  const segs = segments(text, MAX_DEPTH);
  const braces = blockBraces(text, segs);
  const bodies = [];
  segs.forEach((w, k) => {
    const psDo = w.length === 1 && w[0] === "do" && braces[k].some(([ch]) => ch === "{");
    if (LOOP_KEYWORD.test(headOf(w)) || psDo) bodies.push(text.slice(w.span[0], loopEnd(text, segs, k, braces)));
    if (depth >= MAX_DEPTH) return;
    const inner = w.flatMap((x) => [...x.matchAll(/\$\(/g)].map((m) => x.slice(m.index + 2, closing(x, m.index + 1))));
    for (const body of [shellBodyIn(w), ...inner]) if (body) bodies.push(...loopBodies(body, depth + 1));
  });
  return bodies;
}
const shellBodyIn = (w) => {
  const i = w.findIndex((x) => SHELL.test(commandName(x)));
  return i < 0 ? null : shellBodyOf(commandName(w[i]), w.slice(i + 1));
};
