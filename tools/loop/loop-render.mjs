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

/** A–F are the session's own; `G` is the supervisor's, after it has exited. @type {[string, string][]} */
export const PHASES = [
  ["A", "claim"],
  ["B", "scope"],
  ["C", "build"],
  ["D", "review"],
  ["E", "push"],
  ["F", "close"],
  ["G", "land"],
];

export const LAND = "G";

/** Braille, because every frame is one column wide in every terminal font. */
export const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** The row the board shows before the session has named a phase. Never recorded as one. */
export const UNNAMED = "?";

const LABEL = 12;
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
export function tasksDetail(tasks, ms, width = DETAIL) {
  if (!tasks.length) return null;
  const last = tasks[tasks.length - 1];
  const parts = [
    `${tasks.length} agent${tasks.length === 1 ? "" : "s"}`,
    last.what ?? last.tool ?? null,
    `${Math.floor(ms / MINUTE_MS)}m`,
  ].filter(Boolean);
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
  const right = ms == null ? null : { t: elapsed(ms), c: "faint" };
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
  const [head, ...rest] = String(text ?? "").split("\n");
  const rows = [stepRow({ label, detail: head, ms: null, state: "warned" }, t)];
  if (rest.length) rows.push(note(rest.join("\n"), t));
  return rows.filter(Boolean).join("\n");
}

// A resumed process re-enters a phase rather than starting it fresh — "claim" and "land" both
// name a one-shot action neither row is doing.
const RESUMED_LABEL = { A: "start", G: "settle" };

/** "review 2/4" where there is a round to name, "fix 2/3" where the round is a CI retry. */
const labelFor = (letter, round, resumed = false) => {
  const at = PHASES.findIndex(([l]) => l === letter);
  const base = at >= 0 ? PHASES[at][1] : letter;
  const name = resumed ? (RESUMED_LABEL[letter] ?? base) : base;
  if (round?.fix) return `fix ${round.n}/${round.of}`;
  return round ? `${name} ${round.n}/${round.of}` : name;
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

// Eighth-blocks, so the bar advances a fraction of a cell rather than jumping a whole one. The
// remainder is drawn as one partial block, which is why `used` counts it.
const EIGHTH = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

/** @param {number} frac 0…1 */
export function bar(frac, width, t) {
  const share = Number.isFinite(frac) ? Math.max(0, Math.min(1, frac)) : 0;
  const total = share * width;
  const full = Math.floor(total);
  const part = EIGHTH[Math.floor((total - full) * 8)] ?? "";
  const used = full + (part ? 1 : 0);
  return (
    t.paint("accent", "█".repeat(full) + part) +
    t.paint("faint", "░".repeat(Math.max(0, width - used)))
  );
}

/**
 * Median minutes a phase takes: A–F from `npm run loop:cost`, G from `gh run list --workflow
 * ci.yml`. Re-read them there rather than trusting these. D is one review round rather than the
 * whole phase: that output's phase D median divided by the median review rounds beside it.
 *
 * @type {Record<string, number>}
 */
export const PHASE_MINUTES = { A: 1.2, B: 3.3, C: 8, D: 8.2, E: 1.9, F: 0.8, G: 5.7 };

/** Each phase's slice of the bar, by what it costs in wall clock rather than by an even seventh. */
const SPAN = (() => {
  const total = PHASES.reduce((n, [l]) => n + PHASE_MINUTES[l], 0);
  let at = 0;
  return Object.fromEntries(
    PHASES.map(([l]) => {
      const from = at / total;
      at += PHASE_MINUTES[l];
      return [l, [from, at / total]];
    }),
  );
})();

/**
 * Nine tenths of the phase's slice at its median, asymptotic after: half of all runs are longer
 * than the median, and a bar that entered the next phase's slice early would have to go backwards
 * when the marker arrived. `MOST` caps it because `creep` saturates to exactly 1 in floating point
 * long before the work does, and a full bar beside a turning spinner discredits the whole board.
 */
const creep = (x) => 1 - 0.1 ** x;
const MOST = 0.999;

/**
 * Where the ticket is. The letter is deliberately absent: a person reads "review", not "D", and the
 * phase letters are an artefact of the protocol rather than something the board owes anyone.
 *
 * The label slot is fixed and the bar takes what is left, so the bar's right edge does not move
 * between "review" and "no phase" — a bar that changes length as it fills reads as jitter.
 *
 * @param {{letter: string, ms?: number, frac?: number|null,
 *   round?: {n: number, of: number, fix?: boolean}|null}} at `ms` is time in *this* phase.
 */
export function progress({ letter, ms = 0, frac = null, round = null }, t) {
  const at = PHASES.findIndex(([l]) => l === letter);
  const known = at >= 0;
  const [from, to] = SPAN[letter] ?? [0, 0];
  const live = () => Math.min(from + (to - from) * creep(ms / 6e4 / PHASE_MINUTES[letter]), MOST);
  const share = frac ?? (known ? live() : 0);
  const name = clamp(known ? labelFor(letter, round) : "no phase", LABEL).padEnd(LABEL);
  // Floored, so only a caller naming a finished ticket's own `frac` can print 100.
  const pct = known ? `${String(Math.floor(share * 100)).padStart(3)}%` : "   —";
  const width = t.width - LABEL - 11;
  return (
    `   ${t.paint("faint", "▕")}${bar(share, width, t)}${t.paint("faint", "▏")}` +
    `  ${t.paint(known ? "bright" : "warn", name, known)}${t.paint("muted", pct)}`
  );
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

const ordinal = (n) =>
  n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");

/**
 * The ticket, boxed. Two lines of chrome buys a hard edge, which is what makes a night of scrollback
 * skimmable by ticket instead of by hunting for the next header.
 *
 * The number is the link, so the URL does not need a line of its own — it was the same forty
 * characters every ticket and the only varying part was already in the header. A resumed ticket
 * never went through the picker, so it has no queue depths; printing zeroes would read as an
 * empty queue.
 *
 * @param {{number: number, title: string, size?: string|null, url?: string,
 *   queue: {implement: number, triage: number, wayfinder: number}|null,
 *   nth?: number, runMs?: number, spend?: number}} ticket
 */
export function header({ number, title, size, url, queue, nth, runMs, spend }, t) {
  const id = `#${number}`;
  const tag = size ?? "";
  const inner = t.width - 2;

  // Laid out as plain text and measured, then painted. Every fixed piece is counted here rather
  // than assumed, because a header one cell too wide wraps and the redraw below it erases the
  // wrong row from then on.
  const head = `╭─ ${id}  `;
  const tail = tag ? ` ${tag} ─╮` : " ─╮";
  const room = t.width - cols(head) - cols(tail) - 1;
  const shown = clamp(title, Math.max(8, room - 1));
  const fill = "─".repeat(Math.max(1, room - cols(shown)));
  const top =
    t.paint("faint", "╭─ ") +
    t.link(url, t.paint("bright", id, true)) +
    t.paint("faint", "  ") +
    t.paint("text", shown) +
    t.paint("faint", ` ${fill}`) +
    t.paint("faint", tail);

  const facts = clamp(
    [
      queue ? `${queue.implement} queued` : "resumed",
      nth ? `${nth}${ordinal(nth)} tonight` : null,
      runMs != null ? elapsed(runMs) : null,
      spend != null ? money(spend) : null,
    ]
      .filter(Boolean)
      .join(" · "),
    Math.max(0, inner - 3),
  );
  return [
    top,
    t.paint("faint", "│  ") +
      t.paint("faint", facts) +
      " ".repeat(Math.max(0, inner - cols(facts) - 2)) +
      t.paint("faint", "│"),
    t.paint("faint", `╰${"─".repeat(inner)}╯`),
  ].join("\n");
}

/**
 * What can be pressed. The letter carries the colour and the word does not, so the bar reads as a
 * key list rather than as one more row of content competing with the board.
 *
 * Nothing is offered here that the ticker does not bind — a key bar that lies is worse than no key
 * bar, and `tests/loopRender.test.ts` pins this list against the ticker's own handler.
 */
export const KEYS = [
  ["e", "expand", "collapse"],
  ["s", "stop after this", "● stopping after this"],
  ["o", "issue", null],
  ["l", "log", null],
];

export function keybar({ expanded = false, stopping = false } = {}, t) {
  // A pending stop rides on the key that set it rather than on a badge of its own: one place to
  // look for what `s` did, and no second element competing for the right-hand edge.
  const state = { e: expanded, s: stopping };
  // Dropped from the right rather than truncated: half a key name is worse than one fewer key, and
  // the leftmost are the ones worth keeping.
  const segs = [{ t: "   ", c: "faint" }];
  let used = 3;
  for (const [k, off, on] of KEYS) {
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
 * The queue after a ticket, against the queue before it. The header carries the depth; the
 * direction is what matters across an unattended night — a frontier that grows every ticket is the
 * loop filing follow-ups faster than it lands them.
 */
export function queueLine(before, after, t) {
  if (!after.implement && !after.triage && !after.wayfinder) {
    return t.paint("faint", "     queue empty");
  }
  const moved = (k) => (before[k] === after[k] ? String(after[k]) : `${before[k]}→${after[k]}`);
  return t.paint(
    "faint",
    `     queue ${moved("implement")} implement · ${moved("triage")} triage · ${moved("wayfinder")} wayfinder`,
  );
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
    ? `${files} files · ${turns} turns · ${elapsed(ms)} · ${money(cost)}`
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
  return `${tickets} tickets · ${landed} landed · ${parked} parked · ${elapsed(ms)} · ${money(cost)}`;
}
