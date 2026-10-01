import type { DiagRow } from "./types";

const MARK = "murlan-diagnostics-recorder";
const CAP = 5000;
const session = Date.now().toString(36);
let outbox: DiagRow[] = [];
let dropped = 0;
let seq = 0;
let target: string | null = null;

export const recorder = {
  push(row: DiagRow): void {
    if (outbox.length >= CAP) {
      outbox.shift();
      dropped++;
    }
    outbox.push(row);
  },
  postTo(host: string): void {
    if (target === null) {
      outbox = [];
      dropped = 0;
    }
    target = `http://${host}:5099/log`;
  },
};

setInterval(() => {
  if (!target || (outbox.length === 0 && dropped === 0)) return;
  const body = JSON.stringify({ session, seq: seq++, rows: outbox, dropped, build: MARK });
  outbox = [];
  dropped = 0;
  fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body }).catch(() => {});
}, 1000);
