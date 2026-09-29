import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { event } from "@/lib/device/feedback";
import type { Moment } from "@/lib/device/moments";
import { DIAGNOSTICS, diag } from "@/lib/diagnostics";
import { Hold, LATE_SOUND_MS } from "@/lib/tokens";

export type Anchor = "landing" | "handoff";
export interface TableTimeline {
  /** performance.now() ms of the latest reported contact; null before the first flight. */
  landsAt: number | null;
  /** The latest flight's end + Hold.land: when the turn passes (the mockup's gap). */
  handsOffAt: number | null;
  /** True from a throw's commit until landsAt has passed. */
  inFlight: boolean;
  moment(m: Moment, anchor?: Anchor, afterMs?: number): void;
  awaitFlight(key: string): void;
  flightStarted(key: string, landsAt: number, endsAt: number): void;
  flush(): void;
}

type Batch = Map<string, { anchor: Anchor; after: number; moments: Moment[] }>;
interface Times {
  landsAt: number;
  handsOffAt: number;
}

/**
 * A commit's moments go out as one `event` per anchor, at the flight's reported times. Only a
 * batch that waited for its flight can be late: a JS stall past its landing drops it rather than
 * sounding it late. A later commit's moments are never earlier than now.
 */
export function useTableTimeline(): TableTimeline {
  const [clock, setClock] = useState<{ times: Times | null; awaiting: string | null }>({ times: null, awaiting: null });
  const queued = useRef<Batch>(new Map());
  const held = useRef(new Map<string, Batch>());
  const awaiting = useRef<string | null>(null);
  const timesRef = useRef<Times | null>(null);

  const send = useCallback((batch: Batch, times: Times | null, strict: boolean) => {
    const now = performance.now();
    for (const { anchor, after, moments } of batch.values()) {
      const base = times === null ? now : anchor === "landing" ? times.landsAt : times.handsOffAt;
      const at = base + after;
      if (strict && at < now - LATE_SOUND_MS) {
        if (DIAGNOSTICS) diag({ k: "dropped", t: now, name: moments.map((m) => m.kind).join("+") });
        continue;
      }
      event(moments, Math.max(now, at));
    }
  }, []);

  const moment = useCallback((m: Moment, anchor: Anchor = "landing", afterMs = 0) => {
    const key = `${anchor}+${afterMs}`;
    const slot = queued.current.get(key) ?? { anchor, after: afterMs, moments: [] };
    slot.moments.push(m);
    queued.current.set(key, slot);
  }, []);
  const awaitFlight = useCallback((key: string) => {
    awaiting.current = key;
    setClock({ times: null, awaiting: key });
  }, []);
  const flightStarted = useCallback(
    (key: string, landsAt: number, endsAt: number) => {
      const times = { landsAt, handsOffAt: endsAt + Hold.land };
      timesRef.current = times;
      const batch = held.current.get(key);
      held.current.delete(key);
      if (batch) send(batch, times, true);
      if (awaiting.current === key) awaiting.current = null;
      setClock((c) => ({ times, awaiting: c.awaiting === key ? null : c.awaiting }));
    },
    [send]
  );
  const flush = useCallback(() => {
    if (queued.current.size === 0) return;
    const batch = queued.current;
    queued.current = new Map();
    if (awaiting.current !== null) held.current.set(awaiting.current, batch);
    else send(batch, timesRef.current, false);
  }, [send]);

  const { times } = clock;
  const [landedAt, setLandedAt] = useState<number | null>(null);
  useEffect(() => {
    if (times === null) return;
    const id = setTimeout(() => setLandedAt(times.landsAt), Math.max(0, times.landsAt - performance.now()));
    return () => clearTimeout(id);
  }, [times]);
  const inFlight = clock.awaiting !== null || (times !== null && landedAt !== times.landsAt);
  return useMemo(
    () => ({ landsAt: times?.landsAt ?? null, handsOffAt: times?.handsOffAt ?? null, inFlight, moment, awaitFlight, flightStarted, flush }),
    [times, inFlight, moment, awaitFlight, flightStarted, flush]
  );
}
