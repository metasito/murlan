/**
 * The board's glue: what the supervisor draws for a ticket, and the facts its header is drawn from.
 */
import { ciRedRounds, reviewRounds } from "./loop-derive.mjs";
import { act, bell, clockAt, closing, header, note, recap, stepRow, tasksDetail, thought, UNNAMED } from "./loop-render.mjs";
import { DIR, ledgerPath, readLedger, ticketTally } from "./loop-logs.mjs";
import { ghTracker } from "./tracker.mjs";
import { LIMITS } from "./limits.mjs";

const { CI_ROUNDS, MAX_REVIEW_ROUNDS } = LIMITS;

/**
 * One ticket's worth of the issue, for the header and the turn bound. Covers the resume path, which
 * has no picker. The review rounds are counted by `loop-derive`'s own parser, so this and the gate
 * cannot disagree.
 *
 * `reviewRounds: null` on a failed read, never 0: a count nobody could take is not a count of none.
 */
export function ticketFacts(number, tracker = ghTracker()) {
  const issue = tracker.facts(number, { stderr: "ignore", timeout: 30_000 });
  if (!issue) return { title: `ticket #${number}`, url: "", size: null, labels: null, reviewRounds: null, ciRounds: 0 };
  const { comments, ...facts } = issue;
  return { ...facts, reviewRounds: reviewRounds(comments), ciRounds: ciRedRounds(comments) };
}

/**
 * The board's round for a phase. `reviewRounds` counts the verdicts already on the issue, so the
 * round about to run is the next one. Null when the tracker could not be read — a number nobody
 * could take is not a count of none.
 */
export const roundOf = (about, { fix = false, retryCount = 0 } = {}) => (phase) => {
  if (phase === "D" && about.reviewRounds != null) return { n: about.reviewRounds + 1, of: MAX_REVIEW_ROUNDS };
  // `retryCount` red CI runs so far is that many fixes, out of the runs after the first.
  if (phase === "C" && fix) return { n: Math.max(1, retryCount), of: CI_ROUNDS - 1, fix: true };
  return null;
};

/** The ticket's header, its keys' context and its first row, before the session says anything. */
export function openTicket(screen, { number, branch = null, queue, at = null, about, log, round, dir = DIR }) {
  if (screen.needsHeader(number)) screen.say(header({ number, ...about, queue }, screen.theme));
  const spentMs = ticketTally(number, readLedger(ledgerPath(undefined, dir))).ms;
  screen.context({ number, url: about.url, log, branch, spentMs });
  if (at) {
    // Opened here, not left for the session's own marker: `state.phase` is already this letter, so
    // the marker is read as "no change" and the board stays dark for the whole of that phase.
    screen.start(at, round(at));
  } else {
    // An unnamed row carries the clock and tool detail through the spawn, the start-up and a missed
    // marker, where the board would otherwise be blank under the header.
    screen.start(UNNAMED);
  }
}

/** `runSession`'s `onState` for the board: each effect `reduceSession` returned, drawn. */
export function sessionView(screen, { number, round }) {
  return (_state, effects) => {
    for (const e of effects) {
      if (e.kind === "session") screen.set({ session: e.id });
      if (e.kind === "start") screen.start(e.letter, round(e.letter));
      if (e.kind === "said") screen.said(thought(e.text));
      if (e.kind === "call") screen.call(e.call.name, act(e.call));
      if (e.kind === "tasks") {
        const detail = tasksDetail(e.tasks);
        if (detail) screen.said(detail);
      }
      if (e.kind === "refused") {
        screen.say(
          closing(
            {
              outcome: "rate_limited",
              number,
              why: `the ${e.window ?? "usage"} limit is spent — resets ${clockAt(e.resetsAt)}`,
              ms: 0,
              cost: 0,
            },
            screen.theme,
          ),
        );
      }
    }
  };
}

/**
 * `screen`, with every line the supervisor says also handed to `keep` as one line of
 * `.loop-logs/supervisor.log`: the board scrolls away, and the file is what a monitor reads after.
 * `settle` keeps its lines through `keep` itself, since its `said` carries the session's words too.
 */
export function journaled(screen, ticket, keep) {
  const write = (text) => {
    try {
      const n = ticket();
      keep(`${new Date().toISOString()}${n == null ? "" : ` #${n}`} ${String(text).replace(/\r?\n/g, " | ")}\n`);
    } catch {
      // A disk that refuses the line costs the line, never the night.
    }
  };
  // Not a spread: `theme` is a getter a resize replaces, and a spread would freeze it.
  return Object.assign(Object.create(screen), {
    notice: (label, text) => {
      write(`${label}: ${text}`);
      screen.notice(label, text);
    },
    warn: (text) => {
      write(text);
      screen.warn(text);
    },
    keep: write,
  });
}

/**
 * What the supervisor draws, as an observer: `runOnce` says its own lines through it, and the real
 * ports draw theirs. Each method is one kind of line on the board.
 */
export function screenEvents(screen) {
  const ticketHeader = (ticket) => {
    if (screen.needsHeader(ticket.number)) screen.say(header(ticket, screen.theme));
  };
  return {
    log: (m, label = "loop") => screen.notice(label, m),
    bell,
    step: (row) => screen.say([stepRow(row, screen.theme), ...(row.note?.trim() ? [note(row.note, screen.theme)] : [])].join("\n")),
    recap: (totals, before, queue) => screen.say(recap(totals, before, queue, screen.theme)),
    header: ticketHeader,
    announce: (ticket, spentMs) => {
      ticketHeader(ticket);
      screen.context({ spentMs });
    },
    published: (pr) => screen.set({ pr }),
    recorded: (row, bill) => {
      // Each of these is said by the row after it: the next phase opening, or the merge step's own
      // result. The log is offered only where something needs reading.
      if (["handoff", "retry", "pushed", "reparked", "armed"].includes(row.outcome)) return;
      const landed = row.outcome === "landed";
      screen.say(closing({ outcome: landed ? "merged" : row.outcome, number: row.number, files: row.files === undefined ? 0 : row.files, ...bill, why: row.why ?? undefined, log: landed ? undefined : row.run.log }, screen.theme));
    },
  };
}
