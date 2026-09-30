import { getMotionPreference, setMotionPreference } from "@/lib/accessibility";
import { registerFramedScenario, type BenchContext } from "../bench";
import { botTable, driveBots } from "../benchTable";
import { diag } from "../index";

const ROUNDS = 5;
const SETTLE_MS = 4000;
const SHOW_MS = 2000;
const GAP_MS = 300;
const STEP_MS = 900;

async function showEach(ctx: BenchContext, reduced: boolean): Promise<void> {
  for (const [kind, names] of Object.entries(ctx.gallery)) {
    for (let fixture = 0; fixture < names.length; fixture++) {
      ctx.frames(true);
      diag({ k: "shown", t: performance.now(), kind, fixture, reduced });
      ctx.showNotice({ kind, fixture });
      await ctx.sleep(SHOW_MS);
      ctx.showNotice(null);
      await ctx.sleep(GAP_MS);
      ctx.frames(false);
    }
  }
}

registerFramedScenario("noticeGallery", async (ctx) => {
  const preference = getMotionPreference();
  const fixtures = Object.values(ctx.gallery).reduce((n, names) => n + names.length, 0);
  diag({ k: "gallery", t: performance.now(), kinds: Object.keys(ctx.gallery).length, fixtures });
  let done = false;
  const bots = (async () => {
    while (!done) await driveBots(ctx, botTable(), STEP_MS, undefined, () => done);
  })();
  try {
    await ctx.sleep(SETTLE_MS);
    for (let round = 0; round < ROUNDS; round++) await showEach(ctx, false);
    setMotionPreference("on");
    await showEach(ctx, true);
  } finally {
    done = true;
    ctx.showNotice(null);
    ctx.frames(false);
    setMotionPreference(preference);
    await bots;
    await ctx.showTable(null);
  }
});
