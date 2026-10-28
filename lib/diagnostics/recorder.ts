import { isBenchHost } from "./benchLaunch.ts";
import type { DiagRow } from "./types";

const MARK = "murlan-diagnostics-recorder";
const CAP = 5000;
const PENDING_CAP = 60;
const POST_TIMEOUT_MS = 10000;
// The longest window is 30 s; a hold that outlives this was never released.
const HOLD_MAX_MS = 45000;
const session = Date.now().toString(36);
let outbox: DiagRow[] = [];
let dropped = 0;
let seq = 0;
let target: string | null = null;
let heldAt: number | null = null;
let sending = false;
const pending: { body: string; rows: number }[] = [];

function seal(): void {
  if (outbox.length === 0 && dropped === 0) return;
  pending.push({ body: JSON.stringify({ session, seq: seq++, rows: outbox, dropped, build: MARK }), rows: outbox.length });
  outbox = [];
  dropped = 0;
  // A batch the PC could not take waits for the next try; past this many, the oldest are given up and counted.
  while (pending.length > PENDING_CAP) dropped += pending.shift()?.rows ?? 0;
}

async function send(): Promise<void> {
  if (sending || !target || pending.length === 0) return;
  sending = true;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: pending[0].body, signal: abort.signal });
    if (res.ok) pending.shift();
  } catch {
    // The batch stays at the head and goes again on the next tick.
  } finally {
    clearTimeout(timer);
    sending = false;
  }
}

export const recorder = {
  push(row: DiagRow): void {
    if (target === null) return;
    if (outbox.length >= CAP) {
      dropped += CAP / 2;
      outbox = outbox.slice(CAP / 2);
    }
    outbox.push(row);
  },
  postTo(host: string): void {
    if (!isBenchHost(host)) return;
    target = `http://${host}:5099/log`;
  },
  /** While a frame window is open nothing is sealed or sent, so the window is not measured under its own upload. */
  hold(on: boolean): void {
    heldAt = on ? Date.now() : null;
    if (!on) recorder.flush();
  },
  flush(): void {
    if (!target) return;
    seal();
    void send();
  },
};

const tick = setInterval(() => {
  if (heldAt === null || Date.now() - heldAt > HOLD_MAX_MS) recorder.flush();
}, 1000);
// Only Node's timers have unref; there it lets a test that imports the recorder exit.
(tick as unknown as { unref?: () => void }).unref?.();
