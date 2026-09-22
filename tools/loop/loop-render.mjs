/**
 * What the loop prints: state in, strings out. Nothing here writes, moves a cursor, or reads a key —
 * `ticker` in queue-loop.mjs is the only thing in the loop that knows those exist.
 *
 * Three rules the whole file rests on.
 *
 * **Measure before painting.** An escape is bytes with no width. Anything padded after it is painted
 * is padded wrong, and a line one column too wide wraps, which puts the next carriage return on the
 * wrong row and takes the redraw with it. Every row here is assembled as segments of plain text with
 * known widths, padded, and painted last.
 *
 * **Hierarchy is brightness, not hue.** Only the row that is happening now is bright; finished work
 * recedes to grey and structure to near-black. Colour carries state and nothing else — a board where
 * six things are green says the same as a board where none of them is.
 *
 * **Degrade, never detect once.** The capability set is passed in, so the same render runs at 256
 * colours, at 16, and down a pipe into `.loop-logs/run-*.md` with no escapes at all. That is also
 * what makes every function here testable without a terminal.
 */

export const WIDTH = 78;
/**
 * The width below which the layout's fixed parts no longer leave room for anything that varies.
 *
 * It is not a floor on the board's width — every row is budgeted to land at exactly `width`, so a
 * board wider than the window wraps every row it draws and the redraw's cursor arithmetic never
 * recovers. `tight` is how a caller asks whether the window is too narrow to draw a live block in
 * at all; the renderer's own `Math.max(0, …)` guards keep it from computing a negative span in the
 * meantime.
 */
export const MIN_WIDTH = 38;

/**
 * What the attached terminal can actually do. Taken from the stream rather than from TERM: Windows
 * sets neither TERM nor COLORTERM, and `getColorDepth` already folds in the console API, NO_COLOR
 * and FORCE_COLOR.
 *
 * @param {{isTTY?: boolean, getColorDepth?: () => number, columns?: number}} stream
 * @param {Record<string, string|undefined>} env
 */
export function capabilities(stream = process.stdout, env = process.env) {
  const tty = Boolean(stream?.isTTY);
  const depth = tty ? (stream.getColorDepth?.() ?? 4) : 1;
  return {
    tty,
    depth,
    colour: depth >= 4,
    c256: depth >= 8,
    // conhost prints an OSC 8 hyperlink instead of consuming it, so the link is offered only where
    // it is known to land. Windows Terminal is the one that advertises itself.
    links: depth >= 4 && Boolean(env.WT_SESSION),
    // Never wider than the window, whatever the window is. A floor applied over this is a board
    // that wraps every row it draws.
    width: Math.max(1, Math.min(WIDTH, (stream?.columns ?? WIDTH + 1) - 1)),
    tight: Math.max(1, Math.min(WIDTH, (stream?.columns ?? WIDTH + 1) - 1)) < MIN_WIDTH,
  };
}

/**
 * Named roles, never a raw colour at a call site — the rule `lib/theme.ts` already holds the app to.
 * Each is a 256-colour index and the 16-colour code to fall back to, because the loop is read in
 * cmd.exe as often as in Windows Terminal.
 *
 * `bright` is spent on one thing per screen: whatever is happening now.
 */
const ROLES = {
  bright: [255, 97],
  text: [252, 37],
  muted: [245, 90],
  faint: [240, 90],
  accent: [39, 96],
  good: [78, 92],
  warn: [214, 93],
  bad: [203, 91],
};

// Built from char codes rather than written as a unicode escape. An escape that one tool along the
// chain resolves arrives as a raw control byte in the file, where it is invisible and the code still
// runs — so nothing fails and the source quietly carries it.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/** A painter bound to one capability set. Pure: same inputs, same string, every time. */
export function theme(caps = capabilities()) {
  const paint = (role, text, bold = false) => {
    if (!caps.colour || !text) return text;
    const [c256, c16] = ROLES[role] ?? ROLES.text;
    const code = caps.c256 ? `38;5;${c256}` : String(c16);
    return `${bold ? `${ESC}[1m` : ""}${ESC}[${code}m${text}${ESC}[0m`;
  };
  const link = (url, text) =>
    caps.links && url ? `${ESC}]8;;${url}${BEL}${text}${ESC}]8;;${BEL}` : text;
  return { caps, paint, link, width: caps.width };
}

/**
 * The painter for anything that goes into a file rather than onto a screen. Named, so a call site
 * writing to `.loop-logs/run-*.md` has to say which it is: an escape in that file is invisible in
 * the morning and shows up as mojibake in the report.
 */
export const PLAIN = () => theme(capabilities({ isTTY: false }));

// Emoji and the CJK blocks take two terminal cells each. Measuring them as one is what makes a
// line that fits on paper wrap in a terminal, and a wrapped line puts the next `\r` on the wrong
// row — which is the whole of the redraw going wrong.
const WIDE =
  /[ᄀ-ᅟ⺀-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]|[\u{1F000}-\u{1FAFF}]/u;

/** How many terminal cells a string takes. Counts code points, never UTF-16 units. */
export function cols(text) {
  let n = 0;
  for (const ch of String(text)) n += WIDE.test(ch) ? 2 : 1;
  return n;
}

/** The longest prefix of `text` that fits in `room` cells. */
export function cut(text, room) {
  let n = 0;
  let out = "";
  for (const ch of String(text)) {
    const w = WIDE.test(ch) ? 2 : 1;
    if (n + w > room) break;
    out += ch;
    n += w;
  }
  return out;
}

/** `text`, or as much of it as fits with an ellipsis owning the last cell. */
export function clamp(text, room) {
  return cols(text) > room ? `${cut(text, Math.max(0, room - 1))}…` : String(text);
}

/**
 * Segments to one row. `right` is pinned to the far edge and never truncated — it is the clock or
 * the money, which is what the line is read for; the left gives way instead.
 *
 * @param {{t: string, c?: string, b?: boolean, url?: string}[]} segs
 * @param {{t: string, c?: string}|null} right
 */
export function row(segs, right, t, width = t.width) {
  const used = segs.reduce((n, s) => n + cols(s.t), 0);
  const gap = right ? Math.max(1, width - used - cols(right.t)) : 0;
  const left = segs.map((s) => t.link(s.url, t.paint(s.c ?? "text", s.t, s.b))).join("");
  return left + " ".repeat(gap) + (right ? t.paint(right.c ?? "faint", right.t) : "");
}

/** A–F are the session's own; `G` is the supervisor's, after it has exited. @type {[string, string, string][]} */
export const PHASES = [
  ["A", "claim", "takes the ticket, makes its worktree, posts the Definition of done"],
  ["B", "scope", "one subagent maps every place the change has to touch"],
  ["C", "build", "writes the change, a commit per slice, then the local checks"],
  ["D", "review", "two independent reviewers read the diff; LAND or HOLD"],
  ["E", "push", "pushes the reviewed head and readies the pull request"],
  ["F", "close", "ticks the Definition of done against the code"],
  ["G", "merge", "waits for ci.yml on that head, then merges"],
];

export const LAND = "G";

/** Braille, because every frame is one column wide in every terminal font. */
export const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** The row the board shows before the session has named a phase. Never recorded as one. */
export const UNNAMED = "?";

const TITLE_FLOOR = 14;
const DETAIL = 44;
const MINUTE_MS = 60_000;

export function elapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = String(total % 60).padStart(2, "0");
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const money = (n) => `$${Number(n ?? 0).toFixed(2)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The stream gives Unix seconds; a wait is only actionable as a time and a distance. */
export function clockAt(resetsAt, now = Date.now()) {
  if (!resetsAt) return "an unknown time";
  const ms = resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
  const time = new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const mins = Math.round((ms - now) / MINUTE_MS);
  if (mins <= 0) return time;
  const gap =
    mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;
  return `${time}, in ${gap}`;
}

const base = (p) => String(p ?? "").split(/[\\/]/).pop();

/**
 * One tool call as the shortest phrase that says what it is doing.
 *
 * Bash and Agent both carry a `description` the model wrote for a person to read, and the board
 * showed the raw command instead. Reading a path down to its basename is the same trade: the
 * worktree prefix is the same forty characters on every row and says nothing.
 *
 * @param {{name: string, input?: Record<string, unknown>, parent?: string|null}} call
 */
export function act({ name, input = {} }) {
  switch (name) {
    case "Bash":
    case "PowerShell":
      return String(input.description || String(input.command ?? "").split("\n")[0] || "");
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return base(input.file_path);
    case "Grep":
    case "Glob":
      return String(input.pattern ?? "");
    case "Agent":
      return String(input.description || input.subagent_type || "");
    case "WebFetch":
      return String(input.url ?? "");
    default:
      return String(input.description ?? "");
  }
}

/**
 * The session's own last sentence, stripped of the markdown it writes for a human.
 *
 * This is the one channel that says *why* rather than *what*, and the supervisor parsed two markers
 * out of it and threw the rest away. "Spec axis — round 2" is a better line to have on screen than
 * the twelfth `Bash` of the phase.
 */
export function thought(text) {
  const last = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);
  if (!last) return null;
  const clean = last
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*>#\s]+/, "")
    .trim();
  return clean || null;
}

/**
 * The narration row's text while work is happening inside a subagent: `readLine()` sees no
 * `assistant` fact from in there, so without this the board sits on whatever it last showed for the
 * whole phase — 78% of a run's clock — and a working session is indistinguishable from a hung one.
 * `tasks` is the caller's live set, most recently touched last; the closing subtypes are the
 * caller's cue to drop an entry, never this function's to reason about.
 *
 * @param {{what: string|null, tool: string|null}[]} tasks
 */
export function tasksDetail(tasks, width = DETAIL) {
  if (!tasks.length) return null;
  const last = tasks[tasks.length - 1];
  // No clock: the spinner row this lands on carries one, and two clocks started apart never agree.
  const parts = [plural(tasks.length, "agent"), last.what ?? last.tool ?? null].filter(Boolean);
  return clamp(parts.join(" · "), width);
}

const MARK = {
  done: ["✓", "good"],
  failed: ["✗", "bad"],
  resumed: ["↻", "warn"],
  warned: ["!", "warn"],
  skipped: ["·", "faint"],
};

const LABEL_W = 10;

/**
 * One thing that happened, as one row: a mark, what it was, what came of it, how long it took.
 *
 * Every settled line the loop prints is this shape, so the marks make one column down the side
 * rather than each arriving in its own format. Brightness is spent on what is happening now, and
 * none of these is.
 */
export function stepRow({ label, detail = "", ms = null, state = "done" }, t) {
  const [glyph, colour] = MARK[state] ?? MARK.done;
  const right = ms == null || ms < 1000 ? null : { t: elapsed(ms), c: "faint" };
  return row(
    [
      { t: "   ", c: "faint" },
      { t: glyph, c: colour },
      { t: "  ", c: "faint" },
      { t: clamp(label, LABEL_W).padEnd(LABEL_W + 1), c: "muted" },
      { t: clamp(detail, Math.max(0, t.width - LABEL_W - 16)), c: "faint" },
    ],
    right,
    t,
  );
}

/**
 * The supervisor's own word, in the same column as everything else it prints.
 *
 * These used to go out as raw `queue-loop: …` lines on stderr, which read as a crash report landing
 * on a board that had just drawn a tidy row. First line is the row; the rest is its note.
 */
export function notice(label, text, t) {
  const [first, ...rest] = String(text ?? "").split("\n");
  // Wrapped, not cut: a warning's last words are usually what to do about it.
  const [head = "", ...more] = wrap(first, Math.max(8, t.width - LABEL_W - 16));
  const tail = [more.join(" "), ...rest].filter(Boolean);
  const rows = [stepRow({ label, detail: head, ms: null, state: "warned" }, t)];
  if (tail.length) rows.push(note(tail.join("\n"), t));
  return rows.filter(Boolean).join("\n");
}

// A resumed process re-enters a phase rather than starting it fresh — "claim" and "land" both
// name a one-shot action neither row is doing.
const RESUMED_LABEL = { A: "start", G: "settle" };

/**
 * "review 2" is the second review, and its ceiling is not shown: "2/4" read as half done. A fix
 * round keeps its ceiling, because how many are left is what decides a park.
 */
const labelFor = (letter, round, resumed = false) => {
  const at = PHASES.findIndex(([l]) => l === letter);
  const base = at >= 0 ? PHASES[at][1] : letter;
  const name = resumed ? (RESUMED_LABEL[letter] ?? base) : base;
  if (round?.fix) return `fix ${round.n} of ${round.of}`;
  return round ? `${name} ${round.n}` : name;
};

/**
 * A finished phase: a step whose name the protocol spells as a letter. A person reads "build".
 * @param {{letter: string, detail?: string, ms: number, state?: string,
 *   round?: {n: number, of: number, fix?: boolean}|null}} phase
 */
export function phaseRow({ letter, detail = "", ms, state = "done", round = null }, t) {
  return stepRow({ label: labelFor(letter, round, state === "resumed"), detail, ms, state }, t);
}

/**
 * What a step said, under the row that names it. Wrapped rather than cut: a row is a summary and
 * may give way at the edge, but losing the end of these is losing the reason for a refusal.
 */
export function note(text, t, indent = 8) {
  const room = Math.max(8, t.width - indent - 1);
  return String(text ?? "")
    .split("\n")
    .flatMap((line) => {
      // A step's own continuation indent is kept, inside ours, so its shape survives the move.
      const lead = Math.min(/^\s*/.exec(line)?.[0].length ?? 0, 4);
      const body = line.trim();
      if (!body) return [];
      return wrap(body, room - lead).map((l) => t.paint("faint", " ".repeat(indent + lead) + l));
    })
    .join("\n");
}

/**
 * Where the ticket is: every phase in order, the finished ones ticked, the current one lit, and
 * the ticket's own clock on the right. A percentage would be a guess from median phase lengths,
 * and a guess reads as a fact on a board nobody is watching closely.
 *
 * Done, current and pending differ by glyph as well as brightness, so a pipe with no colour still
 * says which is which. Where the whole row does not fit, it shows the current phase and its place.
 *
 * @param {{letter: string, round?: {n: number, of: number, fix?: boolean}|null,
 *   ticketMs?: number|null}} at `ticketMs` is the ticket's time across every process so far.
 */
export function progress({ letter, round = null, ticketMs = null }, t) {
  const at = PHASES.findIndex(([l]) => l === letter);
  const right = ticketMs == null ? null : { t: `ticket ${elapsed(ticketMs)}`, c: "muted" };
  const lead = { t: "   ", c: "faint" };
  const segs = [lead];
  if (at < 0) segs.push({ t: "starting  ", c: "warn" });
  PHASES.forEach(([l], i) => {
    if (i) segs.push({ t: "  ", c: "faint" });
    if (i < at) segs.push({ t: `✓${labelFor(l, null)}`, c: "muted" });
    else if (i === at) segs.push({ t: `▸ ${labelFor(l, round)}`, c: "bright", b: true });
    else segs.push({ t: labelFor(l, null), c: "faint" });
  });
  const need = segs.reduce((n, s) => n + cols(s.t), 0) + (right ? cols(right.t) + 1 : 0);
  if (need <= t.width) return row(segs, right, t);
  const name = at < 0 ? "starting" : `▸ ${labelFor(letter, round)}  ${at + 1} of ${PHASES.length}`;
  const room = Math.max(0, t.width - 3 - (right ? cols(right.t) + 1 : 0));
  return row([lead, { t: clamp(name, room), c: at < 0 ? "warn" : "bright", b: at >= 0 }], right, t);
}

const about = (ms) => {
  const m = Math.max(1, Math.round(ms / MINUTE_MS));
  return m < 60 ? `~${m}m` : `~${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};

/**
 * Where the ticket is going, from the ledger's per-step medians: the step after this one, and what
 * is left until it lands. Nothing past the merge step, whose own CI line already says it.
 *
 * @param {Record<string, number>} typical median ms per phase letter
 */
export function ahead(letter, typical, t) {
  const at = PHASES.findIndex(([l]) => l === letter);
  if (at < 0 || at >= PHASES.length - 1) return [];
  const rest = PHASES.slice(at + 1);
  const [next, ...then] = rest;
  const total = rest.every(([l]) => typical[l]) ? about(rest.reduce((n, [l]) => n + typical[l], 0)) : null;
  const line = (label, text) =>
    row([{ t: "   ", c: "faint" }, { t: label.padEnd(LABEL_W), c: "muted" }, { t: clamp(text, Math.max(0, t.width - LABEL_W - 4)), c: "faint" }], null, t);
  return [
    line("next", [next[1], typical[next[0]] ? about(typical[next[0]]) : null, next[2]].filter(Boolean).join(" · ")),
    line("to land", [total && `${total} after ${PHASES[at][1]}`, then.length && `then ${then.map(([, n]) => n).join(", ")}`].filter(Boolean).join(" · ")),
  ];
}

const hhmm = (ms, utc) => {
  const d = new Date(ms);
  const [h, m] = utc ? [d.getUTCHours(), d.getUTCMinutes()] : [d.getHours(), d.getMinutes()];
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/**
 * The run for someone who did not watch it: what needs them first, then where the time went.
 * One text for the `r` key, a long wait, the exit, and the top of `run-*.md`.
 *
 * @param {{startedAt: number, now: number, totals: object, tickets: {number: number, outcome: string, why?: string}[],
 *   ciMs: number, waitMs: number, utc?: boolean}} run
 */
export function runRecap({ startedAt, now, totals, tickets, ciMs, waitMs, utc = false }, t) {
  const wall = now - startedAt;
  const head = (text) => row([{ t: ` ${clamp(text, t.width - 1)}`, c: "text", b: true }], null, t);
  const stuck = tickets.filter((r) => r.outcome !== "landed");
  const working = Math.max(0, wall - ciMs - waitMs);
  return [
    head(`run   ${hhmm(startedAt, utc)} → ${hhmm(now, utc)} · ${elapsed(wall)}`),
    row([{ t: ` ${clamp(`${plural(totals.tickets, "ticket")} · ${totals.landed} landed · ${totals.parked} parked · ${money(totals.cost)}`, t.width - 1)}`, c: "muted" }], null, t),
    ...(stuck.length ? ["", head("needs you"), ...stuck.map((r) => stepRow({ label: `#${r.number}`, detail: r.why ?? r.outcome, state: "failed" }, t))] : []),
    "",
    head("where the time went"),
    stepRow({ label: "", detail: `working ${elapsed(working)} · CI ${elapsed(ciMs)} · waiting ${elapsed(waitMs)}`, state: "skipped" }, t),
  ];
}

// The fade is the information. Four rows at four brightnesses say which is now and which is already
// history without spending a timestamp on each one.
const FADE = ["text", "muted", "faint", "faint"];
export const RECENT = FADE.length;

const spin = (frame) => SPIN[((frame % SPIN.length) + SPIN.length) % SPIN.length];

/**
 * The live block: what the session just said, then the calls behind it, most recent first. This is
 * the only place on the board where more than one row is lit at all.
 *
 * @param {{said: string|null, recent: {name: string, what: string}[], ms: number, frame: number}} live
 */
export function activity({ said, recent = [], ms, frame = 0 }, t, take = RECENT) {
  const head = said ?? (recent[0] ? `${recent[0].name} · ${recent[0].what}` : "working");
  const rows = [
    row(
      [
        { t: "   ", c: "faint" },
        { t: spin(frame), c: "accent", b: true },
        { t: "  ", c: "faint" },
        { t: clamp(head, Math.max(0, t.width - 14)), c: "bright" },
      ],
      { t: elapsed(ms), c: "faint" },
      t,
    ),
  ];
  recent.slice(0, Math.max(0, Math.min(RECENT, take))).forEach(({ name, what }, i) => {
    rows.push(
      row(
        [
          { t: i === 0 ? "      ⎿  " : "         ", c: "faint" },
          { t: String(name).padEnd(7), c: i === 0 ? "accent" : "faint" },
          { t: clamp(what, Math.max(0, t.width - 22)), c: FADE[i] },
        ],
        null,
        t,
      ),
    );
  });
  return rows.join("\n");
}

/**
 * The ticket, boxed. Two lines of chrome buys a hard edge, which is what makes a night of scrollback
 * skimmable by ticket instead of by hunting for the next header.
 *
 * The number is the link, so the URL does not need a line of its own — it was the same forty
 * characters every ticket and the only varying part was already in the header. A resumed ticket
 * never went through the picker, so it has no queue depths; printing zeroes would read as an
 * empty queue. How far the run has got is `recap`'s, outside the box.
 *
 * @param {{number: number, title: string, size?: string|null, url?: string,
 *   queue: {implement: number, triage: number, wayfinder: number}|null}} ticket
 */
export function header({ number, title, size, url, queue }, t) {
  const id = `#${number}`;
  const inner = Math.max(0, t.width - 2);

  // Laid out as plain text and measured, then painted. Every fixed piece is counted here rather
  // than assumed, because a header one cell too wide wraps and the redraw below it erases the
  // wrong row from then on. The tag sheds from the left — `resumed` before the size — rather than
  // pushing the title past the edge, and nothing below is floored above zero for the same reason.
  const head = `╭─ ${id}  `;
  const pieces = [queue ? null : "resumed", size].filter(Boolean);
  let tail = " ─╮";
  let room = 0;
  for (let i = 0; i <= pieces.length; i++) {
    const tag = pieces.slice(i).join(" ─ ");
    tail = tag ? ` ${tag} ─╮` : " ─╮";
    room = t.width - cols(head) - cols(tail) - 1;
    if (room >= TITLE_FLOOR) break;
  }
  const shown = clamp(title, Math.max(0, room - 1));
  const fill = "─".repeat(Math.max(0, room - cols(shown)));
  const plain = `${head}${shown} ${fill}${tail}`;
  const top =
    cols(plain) <= t.width
      ? t.paint("faint", "╭─ ") +
        t.link(url, t.paint("bright", id, true)) +
        t.paint("faint", "  ") +
        t.paint("text", shown) +
        t.paint("faint", ` ${fill}`) +
        t.paint("faint", tail)
      : t.paint("faint", clamp(plain, t.width));

  return [top, t.paint("faint", clamp(`╰${"─".repeat(inner)}╯`, t.width))].join("\n");
}

/**
 * What can be pressed. The letter carries the colour and the word does not, so the bar reads as a
 * key list rather than as one more row of content competing with the board.
 *
 * Nothing is offered here that the ticker does not bind — a key bar that lies is worse than no key
 * bar, and `tools/loop/tests/loopRender.test.ts` pins this list against the ticker's own handler.
 */
export const KEYS = [
  ["e", "expand", "collapse"],
  ["s", "stop after this", "● stopping after this"],
  ["k", "park", "● parking after this", "ticket"],
  ["w", "check now", null, "waiting"],
  ["p", "pr", null, "pr"],
  ["o", "issue", null, "url"],
  ["l", "log", null, "log"],
  ["t", "session", null, "session"],
  ["c", "copy", null, "log"],
  ["r", "run", "close run", "recap"],
  ["?", "keys", "close keys"],
];

/** What `?` shows: every key, then every step, from the same two tables the board draws from. */
export function help(t) {
  const keys = KEYS.map(([k, off]) => row([{ t: `   ${k}  `, c: "accent", b: true }, { t: off, c: "muted" }], null, t));
  const steps = PHASES.map(([, name, meaning]) =>
    row([{ t: `   ${name.padEnd(8)}`, c: "muted" }, { t: clamp(meaning, Math.max(0, t.width - 11)), c: "faint" }], null, t),
  );
  return [...keys, "", ...steps];
}

/**
 * @param {{expanded?: boolean, stopping?: boolean, parking?: false|"confirm"|"asked", help?: boolean,
 *   offers?: Record<string, unknown>}} view `offers` holds what a conditional key needs; a key whose
 *   fourth column names something absent from it is not offered.
 */
export function keybar({ expanded = false, stopping = false, parking = false, recap: recapped = false, help: open = false, offers = {} } = {}, t) {
  if (parking === "confirm") {
    return row([{ t: "   k", c: "accent", b: true }, { t: clamp(" park this ticket?  y confirms · any other key cancels", t.width - 4), c: "warn" }], null, t);
  }
  // A pending stop rides on the key that set it rather than on a badge of its own: one place to
  // look for what `s` did, and no second element competing for the right-hand edge.
  const state = { e: expanded, s: stopping, k: parking === "asked", r: recapped, "?": open };
  // Dropped from the right rather than truncated: half a key name is worse than one fewer key, and
  // the leftmost are the ones worth keeping.
  const segs = [{ t: "   ", c: "faint" }];
  let used = 3;
  for (const [k, off, on, needs] of KEYS) {
    if (needs && !offers[needs]) continue;
    const word = state[k] && on ? on : off;
    const cost = (used > 3 ? 3 : 0) + 2 + cols(word);
    if (used + cost > t.width) break;
    if (used > 3) segs.push({ t: "   ", c: "faint" });
    segs.push({ t: k, c: "accent", b: true });
    segs.push({ t: ` ${word}`, c: state[k] && on ? "warn" : "faint" });
    used += cost;
  }
  return row(segs, null, t);
}

/**
 * Expanded: the stream itself, the way the session would look if you were sitting in front of it.
 * Nothing is summarised here — that is the whole point of the key.
 *
 * @param {{kind: "call"|"said", name?: string, what?: string, text?: string}[]} feed
 */
export function stream(feed, { ms, frame = 0, letter }, t, take = 14) {
  const at = PHASES.findIndex(([l]) => l === letter);
  const rows = [
    row(
      [
        { t: "   ", c: "faint" },
        { t: spin(frame), c: "accent", b: true },
        { t: "  ", c: "faint" },
        { t: PHASES[at]?.[1] ?? "no phase named", c: "bright", b: true },
        { t: `  ·  ${feed.length} events`, c: "faint" },
      ],
      { t: elapsed(ms), c: "faint" },
      t,
    ),
    t.paint("faint", `   ${"─".repeat(Math.max(0, t.width - 4))}`),
  ];
  for (const e of feed.slice(-Math.max(1, take))) {
    rows.push(
      e.kind === "said"
        ? row(
            [
              { t: "      ", c: "faint" },
              { t: clamp(e.text, Math.max(0, t.width - 8)), c: "text" },
            ],
            null,
            t,
          )
        : row(
            [
              { t: "   ·  ", c: "faint" },
              { t: String(e.name).padEnd(7), c: "muted" },
              { t: clamp(e.what, Math.max(0, t.width - 16)), c: "faint" },
            ],
            null,
            t,
          ),
    );
  }
  return rows.join("\n");
}

/**
 * Where the run stands, after a ticket and outside its box. The direction is what matters across
 * an unattended night — a frontier that grows every ticket is the loop filing follow-ups faster
 * than it lands them.
 */
export function recap(totals, before, after, t) {
  const empty = !after.implement && !after.triage && !after.wayfinder;
  const moved = (k) => (before[k] === after[k] ? String(after[k]) : `${before[k]}→${after[k]}`);
  const detail = empty
    ? "empty"
    : `${moved("implement")} to implement · ${moved("triage")} to triage · ${moved("wayfinder")} wayfinder`;
  return [
    stepRow({ label: "run", detail: runTotal(totals), ms: null, state: "skipped" }, t),
    stepRow({ label: "queue", detail, ms: null, state: "skipped" }, t),
  ].join("\n");
}

/**
 * Rings once, and only at a terminal a person could be sitting at. Wrapped because a run must never
 * end on a closed pipe, and it goes to stderr so a piped stdout stays clean.
 */
export function bell(out = process.stderr) {
  if (!out?.isTTY) return;
  try {
    out.write(BEL);
  } catch {
    /* a bell is never worth an exception */
  }
}

const OUTCOME = {
  landed: ["✓", "good"],
  merged: ["✓", "good"],
  parked: ["!", "warn"],
  stalled: ["!", "warn"],
  rate_limited: ["⏸", "warn"],
  retry: ["↻", "accent"],
  handoff: ["→", "muted"],
  pushed: ["↑", "muted"],
  failed: ["✗", "bad"],
};

/**
 * @param {{outcome: string, number: number, ms: number, cost: number,
 *   files?: number, turns?: number, log?: string, why?: string}} run
 */
export function closing({ outcome, number, files, turns, ms, cost, why, log }, t) {
  const [glyph, colour] = OUTCOME[outcome] ?? ["·", "faint"];
  const landed = outcome === "landed" || outcome === "merged";
  const facts = landed
    ? `${elapsed(ms)} · ${money(cost)} · ${plural(turns, "turn")} · ${plural(files, "file")}`
    : (why ?? "");
  const state = outcome.replace("_", " ");
  const id = `#${number}`;
  // Measured from the pieces themselves. A budget written as a constant was right for a four-digit
  // number and the outcome words of the day, and wrong — by one wrapped row — for the first five
  // digit issue.
  const fixed = 3 + cols(glyph) + 2 + cols(id) + 1 + cols(state) + 2;
  const head = row(
    [
      { t: "   ", c: "faint" },
      { t: glyph, c: colour, b: true },
      { t: "  ", c: "faint" },
      { t: id, c: "bright", b: true },
      { t: " ", c: "faint" },
      { t: state, c: colour },
      { t: "  ", c: "faint" },
      { t: clamp(facts, Math.max(0, t.width - fixed)), c: "muted" },
    ],
    null,
    t,
  );
  return log ? `${head}\n${t.paint("faint", `      ${log}`)}` : head;
}

/**
 * One line per ticket, for `.loop-logs/run-*.md`.
 *
 * Budgeted from the edges in: the clock and the money are fixed, the state word is fixed, and the
 * title and the reason share what is left. The title gives way first — a parked row exists to say
 * why it parked, and this is the file the morning is read from.
 *
 * @param {{number: number, title: string, outcome: string, ms: number, cost: number,
 *   pr?: number|null, why?: string}} run
 */
export function reportRow({ number, title, outcome, pr, ms, cost, why }, t) {
  const [glyph] = OUTCOME[outcome] ?? ["·"];
  const right = `${elapsed(ms).padStart(7)}  ${money(cost).padStart(7)}`;
  const label = `${glyph} #${number} `;
  const reason = pr ? `PR #${pr}` : (why ?? "");
  const target = t.width - cols(right) - 1;
  const state = outcome.padEnd(8);
  const forReason = Math.max(0, target - cols(label) - cols(state) - TITLE_FLOOR - 1);
  // A reason too long to sit beside the title goes under the row in full rather than being cut to
  // its first few words.
  const wraps = cols(reason) > forReason;
  const middle = state + (wraps ? "" : reason);
  const shown = clamp(title, Math.max(0, target - cols(label) - cols(middle) - 1));
  const pad = Math.max(1, target - cols(label) - cols(shown) - cols(middle));
  const line = row(
    [
      { t: label, c: "text" },
      { t: shown, c: outcome === "parked" ? "faint" : "muted" },
      { t: " ".repeat(pad), c: "faint" },
      { t: middle, c: "faint" },
    ],
    { t: right, c: "faint" },
    t,
  );
  if (!wraps) return line;
  return [line, ...wrap(reason, t.width - 6).map((l) => t.paint("faint", `      ${l}`))].join("\n");
}

/**
 * The terminal's title, so where a run stands is visible from another window.
 * @param {{number: number, letter?: string, round?: number|null, waitMs?: number|null, ticketMs?: number|null}} at
 */
export function stepTitle({ number, letter, round = null, waitMs = null, ticketMs = null }) {
  const step =
    waitMs != null ? `waiting · ${elapsed(waitMs)} left` : letter && letter !== UNNAMED ? labelFor(letter, round) : "starting";
  return [`#${number} ▸ ${step}`, ticketMs == null ? null : elapsed(ticketMs)].filter(Boolean).join(" · ");
}

/** The merge step's live line: the first red job is named the moment it goes red. */
export function ciLine(pr, { done, total, running, failed }) {
  const now = failed ? `${failed} failed` : running ? `${running} running` : "queued";
  return `PR #${pr} · CI ${done} of ${total} jobs · ${now}`;
}

/** Greedy word wrap. A word longer than the room is cut; nothing is allowed past `room`. */
export function wrap(text, room) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const piece = cols(word) > room ? `${cut(word, room - 1)}…` : word;
    if (line && cols(line) + 1 + cols(piece) > room) {
      out.push(line);
      line = piece;
    } else line = line ? `${line} ${piece}` : piece;
  }
  if (line) out.push(line);
  return out;
}

export function runTotal({ tickets, landed, parked, ms, cost }) {
  return `${plural(tickets, "ticket")} · ${landed} landed · ${parked} parked · ${elapsed(ms)} · ${money(cost)}`;
}
