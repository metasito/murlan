import {
  audioState, backgroundMusic, engineStats, event, setMusicVolume, setSoundVolume, startFeedback, startLandingPulses, type Moment,
} from "@/lib/device/feedback";
import type { TrackId } from "@/lib/device/musicTracks";
import { registerBenchScenario, type BenchContext } from "../bench";
import { diag } from "../index";
import { probe } from "../probe";

const CYCLE: Moment[][] = [
  [{ kind: "landing", cards: 1, bomb: false, mine: true }],
  [{ kind: "turn" }],
  [{ kind: "pass" }],
  [{ kind: "landing", cards: 2, bomb: false, mine: false }],
  [{ kind: "select" }],
  [{ kind: "landing", cards: 4, bomb: true, mine: false }],
  [{ kind: "pass" }, { kind: "roundWon" }],
  [{ kind: "deal" }],
];
const TRACKS: TrackId[] = ["menu", "hand", "cue"];

registerBenchScenario("smoke", (ctx) => soak(ctx, 1));
registerBenchScenario("soak", (ctx) => soak(ctx, Number(ctx.params.minutes ?? "30")));

async function soak(ctx: BenchContext, minutes: number): Promise<void> {
  await startFeedback();
  await probe.stopCapture().catch(() => false);
  setSoundVolume(1);
  setMusicVolume(1);
  const t0 = performance.now();
  let lastSample = -Infinity;
  let lastManche = t0;
  let minute = -1;
  for (let i = 0; performance.now() - t0 < minutes * 60000; i++) {
    const now = performance.now();
    const m = Math.floor((now - t0) / 60000);
    if (m !== minute) {
      minute = m;
      backgroundMusic(TRACKS[m % TRACKS.length]);
    }
    const batch = CYCLE[i % CYCLE.length];
    if (now - lastManche >= 300000) {
      lastManche = now;
      event([{ kind: "mancheOver", outcome: "won" }], now + 500);
    } else {
      event(batch);
      if (batch[0].kind === "landing") startLandingPulses(batch[0]);
    }
    if (now - lastSample >= 10000) {
      lastSample = now;
      const stats = engineStats();
      diag({ k: "engine", t: now, state: audioState(), audioMs: stats.audioMs, plays: stats.plays });
      const mb = probe.footprintMb();
      if (mb !== null) diag({ k: "footprint", t: now, mb });
    }
    await ctx.sleep(1200);
  }
}
