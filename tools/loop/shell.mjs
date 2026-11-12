/**
 * A command line as the simple commands it runs. Every guard and the stream reader read it through
 * this one parser, so a spelling one of them understands the others do too.
 */
import { tmpdir } from "node:os";

const SHELL = /^(bash|sh|zsh|dash|pwsh|powershell|cmd|iex|invoke-expression|eval)$/;
const PIPED_TO_SHELL = /^[^\n]*\|\s*(?:\S*[\\/])?(bash|sh|zsh|dash|pwsh|powershell|iex|invoke-expression)\b/i;
const WRAPPER = new Set(["env", "xargs", "time", "do", "then", "else", "elif", "if", "while", "until", "!", "exec", "nohup", "command", "builtin", "sudo", "nice"]);
const WRAPPER_TAKES_A_VALUE = /^-(?:[IinPdLEsau]|-(?:max-args|max-procs|delimiter|replace|arg-file|unset))$/;
const GIT_TAKES_A_VALUE = /^(-C|-c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix)$/;
const GH_TAKES_A_VALUE = /^(-R|--repo|--hostname)$/;
const REDIRECT = /^(?:\d*|\{[A-Za-z_]\w*\})(?:[<>]+|&>>?)(\S*)$/;
const MAX_DEPTH = 5;

export const commandName = (word) => (word ?? "").replace(/\\/g, "/").split("/").pop().replace(/\.(exe|cmd)$/i, "").toLowerCase();

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
 * Windows paths) except before a quote or a newline, and a backtick separates (PowerShell's escape);
 * `posix` reads both as bash does: an escape, and a `` `…` `` substitution like `$( … )`; it also
 * decodes `$'…'`. A segment a `|` feeds is marked `fed`.
 */
function segments(text, depth, posix = false, base = 0) {
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
    words.span = [base + from, base + i];
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
      if (depth < MAX_DEPTH) out.push(...segments(text.slice(i + 2, end), depth + 1, posix, base + i + 2));
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
    if (posix && ch === "\\" && i + 1 < text.length && (quote === null || /[$`\\]/.test(text[i + 1]))) {
      word = (word ?? "") + text[i + 1];
      i += 1;
      continue;
    }
    if (posix && ch === "`" && text[i + 1] !== "\n") {
      let end = i + 1;
      while (end < text.length && (text[end] !== "`" || text[end - 1] === "\\")) end += 1;
      if (depth < MAX_DEPTH) out.push(...segments(text.slice(i + 1, end), depth + 1, posix, base + i + 1));
      word = (word ?? "") + text.slice(i, end + 1);
      i = end;
      continue;
    }
    if (posix && quote === null && ch === "$" && text[i + 1] === "'") {
      let end = i + 2;
      while (end < text.length && text[end] !== "'") end += text[end] === "\\" ? 2 : 1;
      word = (word ?? "") + ansiC(text.slice(i + 2, end));
      i = end;
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
    } else if (ch === "{" && word === null && /^\{[A-Za-z_]\w*\}[<>]/.test(text.slice(i))) {
      word = text.slice(i, text.indexOf("}", i) + 1);
      i = text.indexOf("}", i);
    } else if (ch === "{" && /^\{[^{}\s]*(?:,|\.\.)[^{}\s]*\}/.test(text.slice(i))) {
      const brace = /^\{[^{}\s]*(?:,|\.\.)[^{}\s]*\}/.exec(text.slice(i))[0];
      word = (word ?? "") + brace;
      i += brace.length - 1;
    } else if (ch === "{" && text[i + 1] === "}") {
      word = (word ?? "") + "{}";
      i += 1;
    } else if (/[;&|\n(){}`]/.test(ch)) {
      const pipe = ch === "|" && text[i - 1] !== "|" && text[i + 1] !== "|";
      if (pipe) words.piped = true;
      endSegment();
      if (pipe) words.fed = true;
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      word = (word ?? "") + ch;
    }
  }
  endSegment();
  return out;
}

const ESCAPES = { a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };

/** The body of a bash `$'…'` as the string it stands for. */
export const ansiC = (body) =>
  body.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|c.|[\s\S])/g, (_, e) =>
    /^[xuU]/.test(e) ? String.fromCodePoint(parseInt(e.slice(1), 16))
    : /^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8))
    : e[0] === "c" && e.length === 2 ? String.fromCharCode(e.charCodeAt(1) & 31)
    : ESCAPES[e] ?? e
  );

/** The command line a shell (or `iex`, `eval`) is handed: its `-c` body, a here-string, or the rest of an `iex` or `eval`. */
function shellBodyOf(cmd, rest) {
  if (cmd === "eval") return (rest[0] === "--" ? rest.slice(1) : rest).join(" ") || null;
  const herestring = rest.indexOf("<<<");
  const windows = /^(pwsh|powershell|cmd)$/.test(cmd);
  const flag = rest.findIndex((a) => (windows ? /^(-c|-command|\/c|\/k)$/i : /^-[A-Za-z]*c[A-Za-z]*$/).test(a));
  if (herestring >= 0) return rest[herestring + 1];
  if (flag < 0) return rest[0] && !rest[0].startsWith("-") && /^(iex|invoke-expression)$/.test(cmd) ? rest.join(" ") : null;
  if (windows) return rest.slice(flag + 1).join(" ");
  return rest[flag + 1] === "--" ? rest[flag + 2] : rest[flag + 1];
}

const EXPANSION = /[$`]/;

/**
 * `word` with each `$name` and `${name}` in `vars` substituted, or null while any expansion is left.
 * @param {string} word @param {Record<string, string>} vars
 */
export function expand(word, vars) {
  if (!EXPANSION.test(word)) return word;
  const out = word.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (m, braced, bare) => vars[braced ?? bare] ?? m);
  return EXPANSION.test(out) ? null : out;
}

/**
 * The command a word names, or null when an expansion decides it. A literal last path step decides
 * it whatever comes before: `$(npm root)/.bin/jest` runs jest.
 */
function nameOf(word, vars) {
  const tail = word.slice(Math.max(word.lastIndexOf(")"), word.lastIndexOf("}")) + 1);
  if (/[\\/]/.test(tail) && !EXPANSION.test(commandName(tail))) return commandName(tail);
  const expanded = expand(word, vars);
  if (expanded === null) return null;
  const bare = word.replace(/\$\{[^}]*\}|\$\w+|\$\([^)]*\)|`[^`]*`/g, "");
  if (/[*?[\]{}]/.test(bare)) return null;
  return expanded !== word && /[*?[]/.test(expanded) ? null : commandName(expanded);
}

const CONTEXT = new WeakMap();

/**
 * What resolved `c`'s words: `vars`, the settled values its expansions were read with, and
 * `assigned`, every name the line (or the shell body it sits in) gives a value; `fed` means a `|` feeds it, `herestring` a `<<<`; `word` is its command word as written, `text` its segment source.
 */
export const contextOf = (c) => CONTEXT.get(c) ?? { vars: {}, assigned: new Set(), fed: false };
const withContext = (c, context) => (CONTEXT.set(c, context), c);

/**
 * One segment as `{ cmd, env, dir, args, piped }`: leading assignments, wrappers and redirections
 * gone, a shell's `-c` body parsed in its place, and git's or gh's global options taken off so
 * `args[0]` is the verb. `env` holds the leading assignments; `dir` is git's last `-C`; `out` is
 * its stdout redirect targets, `redirected` every file a redirect reads or writes, `input` those it reads; `wrapped` the wrappers
 * (`env`, `exec`, …) taken off with their flags; `piped` means its output feeds a `|`. A command
 * word an expansion decides is resolved from `vars`; one it cannot be is `unresolved`, its text the `cmd`.
 */
function normalize(words, depth, vars, assigned) {
  const env = {};
  const wrapped = [];
  let i = 0;
  for (; i < words.length; i++) {
    const assign = /^([A-Za-z_]\w*)=([\s\S]*)$/.exec(words[i]);
    if (assign) {
      env[assign[1]] = assign[2];
    } else if (REDIRECT.test(words[i])) {
      if (!REDIRECT.exec(words[i])[1]) i += 1;
    } else if (nameOf(words[i], vars) === "timeout") {
      while (words[i + 1]?.startsWith("-")) i += /^(-[sk]|--signal|--kill-after)$/.test(words[i + 1]) ? 2 : 1;
      i += 1;
    } else if (WRAPPER.has(nameOf(words[i], vars))) {
      const wrapper = { name: nameOf(words[i], vars), flags: [] };
      wrapped.push(wrapper);
      while (words[i + 1]?.startsWith("-")) {
        wrapper.flags.push(words[i + 1]);
        i += WRAPPER_TAKES_A_VALUE.test(words[i + 1]) ? 2 : 1;
      }
    } else {
      break;
    }
  }
  if (i >= words.length) return [];
  const named = nameOf(words[i], vars);
  const cmd = named ?? commandName(words[i]);
  const rest = words.slice(i + 1);

  if (SHELL.test(cmd) && depth < MAX_DEPTH) {
    const body = shellBodyOf(cmd, rest);
    if (body) {
      const scope = { ...env, ...assignmentsIn(body) };
      const reassigned = boundNames(body);
      const inherited = Object.fromEntries(Object.entries({ ...vars, ...literal(env) }).filter(([k]) => !reassigned.has(k)));
      const inner = commands(body, depth + 1, { ...inherited, ...settledAssignments(body) }, new Set([...assigned, ...reassigned]));
      if (inner.length)
        return inner.map((c) =>
        withContext(
          { ...c, scope: { ...scope, ...c.scope }, wrapped: [...wrapped, { name: cmd, flags: rest, env }, ...c.wrapped], piped: c.piped || words.piped === true },
          contextOf(c),
        ),
      );
    }
  }

  const args = [];
  const out = [];
  const redirected = [];
  const input = [];
  for (let j = 0; j < rest.length; j++) {
    const redirect = REDIRECT.exec(rest[j]);
    if (!redirect) {
      args.push(rest[j]);
      continue;
    }
    const target = redirect[1] || rest[j + 1] || "";
    if (/^[1&]?>/.test(rest[j]) && target && !target.startsWith("&")) out.push(target);
    if (target && !target.startsWith("&")) redirected.push(target);
    if (/^(?:\d*|\{[A-Za-z_]\w*\})<(?!<)/.test(rest[j]) && target && !target.startsWith("&")) input.push(target);
    j += redirect[1] ? 0 : 1;
  }
  let dir = null;
  let configured = false;
  const config = [];
  const globals = cmd === "git" ? GIT_TAKES_A_VALUE : cmd === "gh" ? GH_TAKES_A_VALUE : null;
  if (globals) {
    const end = globalsEnd(args, globals);
    for (let k = 0; k < end; k += globals.test(args[k]) ? 2 : 1) {
      if (cmd === "git" && args[k] === "-C") dir = args[k + 1] ?? dir;
      if (cmd === "git" && /^(-c|--config-env)$/.test(args[k])) {
        configured = true;
        if (args[k + 1]) config.push(args[k + 1]);
      }
    }
    args.splice(0, end);
  }
  const parsed = { cmd, env, dir, args, out, redirected, input, wrapped, configured, config, piped: words.piped === true };
  return [withContext(named === null ? { ...parsed, unresolved: true } : parsed, { vars, assigned, fed: words.fed === true, word: words[i], herestring: words.slice(i).includes("<<<"), span: words.span })];
}

function globalsEnd(args, takesValue) {
  let i = 0;
  while (args[i]?.startsWith("-")) i += takesValue.test(args[i]) ? 2 : 1;
  return i;
}

/** `args` past gh's own global options, so the first word is the verb. */
export const withoutGhGlobals = (args) => args.slice(globalsEnd(args, GH_TAKES_A_VALUE));

/**
 * Every simple command `text` runs, under both readings of a backslash and a backtick: as PowerShell
 * and a Windows path take them, and as bash does (an escape, a command substitution). The guard is not told which shell runs
 * the line, so a rule sees each reading.
 */
export function commands(text, depth = 0, vars = settledAssignments(text), assigned = boundNames(text)) {
  const [literalReading, posixReading = []] = readings(text, depth, vars, assigned);
  const seen = new Set(literalReading.map(([, c]) => JSON.stringify(c)));
  const extra = posixReading.filter(([, c]) => !seen.has(JSON.stringify(c)));
  return [...literalReading, ...extra].sort(([a], [b]) => a - b).map(([, c]) => c);
}

/** Each reading's commands in source order, as `[end, command]`: where the command's segment ends. */
function readings(text, depth = 0, vars = settledAssignments(text), assigned = boundNames(text)) {
  // gh's own `{owner}`/`{repo}`/`{branch}` placeholders, or the braces split an endpoint in three.
  const spelled = depth === 0 ? text.replace(/\{(owner|repo|branch)\}/g, "$1") : text;
  const read = (posix) =>
    segments(spelled, depth, posix)
      .flatMap((words) =>
        normalize(words, depth, vars, assigned).map((c) => {
          const cx = contextOf(c);
          if (cx.text === undefined && cx.span) cx.text = spelled.slice(cx.span[0], cx.span[1]);
          return [words.span[1], c];
        }),
      )
      .sort(([a], [b]) => a - b);
  return /[\\`$]/.test(spelled) ? [read(false), read(true)] : [read(false)];
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
  const feedsShell = (before, after) =>
    readings(before).some((reading) => {
      const last = reading.at(-1)?.[1];
      return last && SHELL.test(last.cmd) && !has(last.args, /^[^-]/);
    }) || PIPED_TO_SHELL.test(after);
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

export function assignmentsIn(text) {
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

/**
 * The literal assignments of variables the line gives one value only: a name reassigned, or bound
 * some other way, cannot be placed. A line that sets `IFS` splits words its own way, so it settles none.
 */
export function settledAssignments(text) {
  const values = {};
  for (const w of segments(text, MAX_DEPTH)) {
    for (const x of w) {
      const m = ASSIGN.exec(x);
      if (m) (values[m[1]] ??= new Set()).add(m[2]);
    }
  }
  const rebound = reboundNames(text);
  if (values.IFS || rebound.has("IFS")) return {};
  return literal(Object.fromEntries(Object.entries(assignmentsIn(text)).filter(([k]) => values[k]?.size === 1 && !rebound.has(k))));
}

const BINDS = /^(read|mapfile|readarray|declare|typeset|local|export|readonly|let|getopts|for|select|unset)$/;

/** Names bound other than by a plain `X=…`: `+=`, an array slot, `read`, `printf -v`, a loop variable, `declare` and kin. */
function reboundNames(text) {
  const out = new Set();
  for (const w of segments(text, MAX_DEPTH)) {
    let i = 0;
    while (/^(do|then|else|elif|!|if|while|until)$/.test(w[i] ?? "")) i += 1;
    for (const x of w) {
      const m = /^([A-Za-z_]\w*)(\[[^\]]*\])?(\+)?=/.exec(x);
      if (m && (m[2] || m[3])) out.add(m[1]);
    }
    if (BINDS.test(w[i] ?? "")) for (const x of w.slice(i + 1)) if (/^[A-Za-z_]\w*(=|$)/.test(x)) out.add(x.split("=")[0]);
    if (w[i] === "printf") w.forEach((x, k) => {
      const v = x === "-v" ? w[k + 1] : /^-v(\w+)$/.exec(x)?.[1];
      if (v) out.add(v.replace(/\[.*$/, ""));
    });
  }
  return out;
}

/** Every name the text gives a value, in any statement and by any binding. */
export function boundNames(text) {
  const out = reboundNames(text);
  for (const w of segments(text, MAX_DEPTH)) for (const x of w) if (ASSIGN.test(x)) out.add(ASSIGN.exec(x)[1]);
  return out;
}

/** Every bare `X=…` statement's variable, whatever its value. */
export const assignedNames = (text) => Object.keys(assignmentsIn(text));

const ITERATES = /^(for|foreach|foreach-object|while|until|%)$/i;
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
      if (ITERATES.test(headOf(segs[j]))) open += 1;
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
    if (ITERATES.test(headOf(w)) || psDo) bodies.push(text.slice(w.span[0], loopEnd(text, segs, k, braces)));
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
