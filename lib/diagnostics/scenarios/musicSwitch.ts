import { backgroundMusic, setMusicVolume } from "@/lib/device/feedback";
import type { TrackId } from "@/lib/device/musicTracks";
import { registerBenchScenario } from "../bench";
import { diag } from "../index";

const TRACKS: TrackId[] = ["menu", "hand"];

registerBenchScenario("musicSwitch", async (ctx) => {
  setMusicVolume(1);
  for (let i = 0; i < 40; i++) {
    diag({ k: "trigger", t: performance.now(), name: "switch" });
    backgroundMusic(TRACKS[i % TRACKS.length]);
    await ctx.sleep(3000);
  }
});
