import { registerFramedScenario, type BenchContext } from "../bench";
import { benchTable, botTable, driveBots } from "../benchTable";
import { benchHandles, diag, type BenchHandles, type DiagRows } from "../index";

const STEP_MS = 900;
const THROW_WINDOW_MS = 600;
const THROW_FRAMES_MS = 700;
const SETTLE_MS = 4000;
const SWITCH_MS = 1000;
const FLUSH_MS = 200;
const PAIRS = 4;

function handle<K extends keyof BenchHandles>(name: K): NonNullable<BenchHandles[K]> {
  const fn = benchHandles[name];
  if (!fn) throw new Error(`no table registered ${name}`);
  return fn;
}

async function halves(ctx: BenchContext, names: readonly DiagRows["half"]["name"][], ms: number, set: (name: DiagRows["half"]["name"]) => void) {
  for (let pair = 0; pair < PAIRS; pair++) {
    for (const name of pair % 2 ? [...names].reverse() : names) {
      set(name);
      await ctx.sleep(SWITCH_MS);
      diag({ k: "half", t: performance.now(), name, pair });
      ctx.frames(true);
      await ctx.sleep(ms);
      ctx.frames(false);
      await ctx.sleep(FLUSH_MS);
    }
  }
}

registerFramedScenario("throwStalls", async (ctx) => {
  let closed = Promise.resolve();
  let live = true;
  try {
    await driveBots(ctx, botTable(), STEP_MS, (s) => {
      if (!s.lastPlayedCombination || s.passCount !== 0) return;
      const t = performance.now();
      ctx.frames(true, t + THROW_WINDOW_MS);
      diag({ k: "throw", t });
      closed = ctx.sleep(THROW_FRAMES_MS).then(() => {
        if (live) ctx.frames(false);
      });
    });
    await closed;
    await ctx.sleep(FLUSH_MS);
  } finally {
    live = false;
    ctx.frames(false);
    await ctx.showTable(null);
  }
});

registerFramedScenario("restCost", async (ctx) => {
  await ctx.showTable(benchTable());
  await ctx.sleep(SETTLE_MS);
  try {
    await halves(ctx, ["frozen", "swaying"], 30000, (name) => handle("lampFreeze")(name === "frozen" ? 1 : 0));
  } finally {
    benchHandles.lampFreeze?.(0);
  }
  await ctx.showTable(null);
});

registerFramedScenario("feltOpaque", async (ctx) => {
  await ctx.showTable(benchTable());
  await ctx.sleep(SETTLE_MS);
  try {
    await halves(ctx, ["on", "off"], 20000, (name) => handle("feltOpaque")(name === "on"));
  } finally {
    benchHandles.feltOpaque?.(true);
  }
  await ctx.showTable(null);
});
