// The `reconnect` moment beside the mockup's chapter, on real time: the socket's own timers stall
// under the virtual clock (#1250), so neither side installs it. The app's socket goes through a
// WebSocket route, which drops it at once and refuses it until let back.
import { test, expect, type Browser, type Page, type WebSocketRoute } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openApp, registerNewAccount, uniqueUsername } from "./navigation";
import { createRoom, fillWithBotsAndStart, goToOnlineLobby } from "./online";
import { CANVASKIT_ROUTE, FIXTURE, fitFrame, recorded, sideContext } from "./mockupParity";
import { anchorsOf, diffReconnect, onChapterClock } from "./reconnectDiff";
import { STEP_MS, type TraceFrame } from "./traceDiff";

/** The mockup's chapter: the drop at 700, back at 3400 (`index.html`'s `reconnect`). */
const CHAPTER = { drop: 700, back: 3400 };
const UNTIL = 5200;
/** Before the drop, held and lit, and back with the colour returned: kept as frames for the page. */
const SHOTS = [500, 2200, 4400];

interface Side {
  frames: TraceFrame[];
  shots: { t: number; jpeg: Buffer }[];
}

const MOCKUP_RECORDER = `(() => {
  window.__parityOnsets = [];
  window.__frames = [];
  const push = (s) => window.__parityOnsets.push(s);
  const sound = sfx;
  window.sfx = (k) => { push("sound:" + k); sound(k); };
  const grey = grayTo;
  window.grayTo = (to, ms) => { if (to > 0) push("moment:drop"); grey(to, ms); };
  const pill = net;
  window.net = (cls, text) => { if (cls !== S.net) push("moment:net-" + cls); pill(cls, text); };
  const sample = () => {
    window.__frames.push({
      t: sceneT, onsets: window.__parityOnsets.splice(0), grey: +(world.dataset.gray || 0),
      lamp: { x: lamp.lx, y: lamp.ly, level: lamp.L, flare: lamp.f, r: lamp.r, ph: lamp.ph, freeze: lamp.freeze },
    });
    requestAnimationFrame(sample);
  };
  start(CH.findIndex((c) => c.key === "reconnect"));
  requestAnimationFrame(sample);
})()`;

async function captureMockup(browser: Browser): Promise<Side> {
  const page = await (await sideContext(browser)).newPage();
  await page.goto(FIXTURE);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const box = await fitFrame(page);
  await page.evaluate(MOCKUP_RECORDER);
  const shots: Side["shots"] = [];
  for (const t of SHOTS) {
    await page.waitForFunction(`sceneT >= ${t}`);
    shots.push({ t, jpeg: await page.screenshot({ type: "jpeg", quality: 80, clip: box }) });
  }
  await page.waitForFunction(`sceneT >= ${UNTIL}`);
  const frames = (await page.evaluate("window.__frames")) as TraceFrame[];
  await page.context().close();
  return { frames, shots };
}

const appNow = (page: Page) => page.evaluate(() => performance.now());
const untilTraced = async (page: Page, accept: (frames: TraceFrame[]) => boolean, what: string) =>
  expect.poll(async () => accept(await recorded(page)), { message: what, timeout: 20_000, intervals: [50] }).toBe(true);

async function captureApp(browser: Browser, baseURL: string): Promise<Side> {
  const context = await sideContext(browser, baseURL);
  const page = await context.newPage();
  await page.route(CANVASKIT_ROUTE, () => undefined);
  let refused = false;
  const live = new Set<WebSocketRoute>();
  await page.routeWebSocket(/socket\.io/, (ws) => {
    if (refused) return void ws.close();
    live.add(ws).add(ws.connectToServer());
  });
  await openApp(page, baseURL);
  await registerNewAccount(page, uniqueUsername("e2epar"));
  await goToOnlineLobby(page);
  await createRoom(page, { playerCount: 2, gameMode: "free_for_all" });
  await fillWithBotsAndStart(page);
  await expect(page.locator('[data-testid="game-table"]')).toBeVisible();

  await page.evaluate(() => (window as unknown as { murlanTrace: { start(): void } }).murlanTrace.start());
  const t0 = (await appNow(page)) - CHAPTER.drop;
  const shots: Side["shots"] = [];
  const shoot = async (t: number) => {
    await page.waitForFunction((at) => performance.now() >= at, t0 + t);
    shots.push({ t, jpeg: await page.screenshot({ type: "jpeg", quality: 80 }) });
  };
  await shoot(SHOTS[0]);
  await page.waitForFunction((at) => performance.now() >= at, t0 + CHAPTER.drop);
  refused = true;
  for (const ws of live) await ws.close();
  live.clear();
  const dropped = (f: TraceFrame) => f.onsets.includes("moment:drop");
  await untilTraced(page, (f) => f.some(dropped), "the app drops");
  const drop = (await recorded(page)).find(dropped)!.t;
  await page.waitForFunction((at) => performance.now() >= at, drop + (SHOTS[1] - CHAPTER.drop));
  shots.push({ t: SHOTS[1], jpeg: await page.screenshot({ type: "jpeg", quality: 80 }) });
  await page.waitForFunction((at) => performance.now() >= at, drop + (CHAPTER.back - CHAPTER.drop));
  refused = false;
  await untilTraced(page, (f) => anchorsOf(f) !== null, "the app comes back");
  const back = anchorsOf(await recorded(page))!.back;
  await page.waitForFunction((at) => performance.now() >= at, back + (SHOTS[2] - CHAPTER.back));
  shots.push({ t: SHOTS[2], jpeg: await page.screenshot({ type: "jpeg", quality: 80 }) });
  await page.waitForFunction((at) => performance.now() >= at, back + (UNTIL - CHAPTER.back));
  const frames = await recorded(page);
  await context.close();
  return { frames, shots };
}

export function reconnectParityTest() {
  test("reconnect, on real time, aligned on the drop and the way back", async ({ browser, baseURL }) => {
    test.setTimeout(5 * 60_000);
    const mockup = await captureMockup(browser);
    const app = await captureApp(browser, baseURL!);
    const failures = diffReconnect({ mockup: mockup.frames, app: app.frames });

    const dir = test.info().outputPath("reconnect-realtime");
    fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
    const own = anchorsOf(app.frames);
    const sides = Object.fromEntries(
      (["mockup", "app"] as const).map((name) => {
        const side = name === "mockup" ? mockup : app;
        const frames = name === "app" && own ? onChapterClock(side.frames, own, CHAPTER) : side.frames;
        const shots = side.shots.map(({ t, jpeg }) => {
          const file = `frames/${name}-${String(t).padStart(5, "0")}.jpg`;
          fs.writeFileSync(path.join(dir, file), jpeg);
          return { t, file, sha1: createHash("sha1").update(jpeg).digest("hex") };
        });
        return [name, { trace: { frames: frames.filter((f) => f.t >= 0 && f.t <= UNTIL), regions: [] }, frames: shots }];
      })
    );
    const parity = { murlanParity: 1, moment: "reconnect-realtime", mode: "parity", stepMs: STEP_MS, checkpoints: [CHAPTER.drop, CHAPTER.back], sides, failures };
    fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify(parity));
    await test.info().attach("reconnect-realtime/parity.json", { path: path.join(dir, "parity.json"), contentType: "application/json" });
    for (const side of Object.values(sides)) {
      for (const f of side.frames) await test.info().attach(`reconnect-realtime/${f.file}`, { path: path.join(dir, f.file), contentType: "image/jpeg" });
    }
    expect(failures, "the app's reconnect against the mockup's chapter").toEqual([]);
  });
}
