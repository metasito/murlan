// Where the Lantern mockup (tests/e2e/fixtures/lantern-table/index.html) is made to do what the app
// does instead of what it drew, so a parity run compares like with like (plan 3 L5).
import { expect, type Page } from "@playwright/test";
import { anchorPoints } from "../../../components/flightPhysics";
import { DESIGN, GLIDE, LAMP_VARIANT, LAMP_VARIANTS, LIGHT_ABOVE, lampPools, type LampTarget, type Pool } from "../../../components/table/lampRig";
import { CLOTH_DEPARTURES } from "../../helpers/lanternFixture";
import { phoneTable } from "../../helpers/phoneTable";

/** The mockup's names for the seats, by the direction each sits in. */
export const MOCKUP_SEAT = { bottom: "you", right: "luan", top: "besnik", left: "gent" } as const;

/**
 * The app's pools at the mockup's own size and seating. `tests/ui-rules/lampRig.test.ts` holds its
 * discs within 1.2 pt of these anchors; its hand has no disc, and runs off the bottom edge.
 */
export const MOCKUP_POOLS: Record<LampTarget, Pool> = lampPools(
  anchorPoints(phoneTable(DESIGN.width, DESIGN.height)),
  DESIGN.width,
  DESIGN.height
);

const seats = Object.entries(MOCKUP_SEAT).map(([dir, k]) => [k, MOCKUP_POOLS[dir as LampTarget]] as const);

/**
 * Run in the mockup before `start`: its lamp aims the app's way, rests where the app's does, its
 * reach glides with the pool, and its cloth draws the app's two light lines at the shipped variant.
 */
export const DEPART_SCRIPT = `(() => {
  const seats = ${JSON.stringify(seats)};
  if (Object.keys(POOL).sort().join() !== seats.map(([k]) => k).sort().join()) throw new Error("the mockup's POOL names other seats: " + Object.keys(POOL));
  const reach = {};
  for (const [k, [x, y, r]] of seats) {
    POOL[k] = [x, y];
    reach[k] = r;
  }
  const reset = resetLamp;
  resetLamp = () => {
    reset();
    [lamp.tx, lamp.ty] = POOL.you;
    [lamp.x, lamp.y] = POOL.you;
    lamp.r = lamp.tr = reach.you;
    lamp.lx = lamp.x;
    lamp.ly = lamp.y - ${LIGHT_ABOVE};
  };
  const aim = lampTo;
  lampTo = (k) => {
    aim(k);
    lamp.tr = reach[k];
  };
  const glide = lampStep;
  lampStep = (dt) => {
    glide(dt);
    lamp.r += (lamp.tr - lamp.r) * (1 - Math.exp(-dt * ${GLIDE}));
  };
  lamp.r = lamp.tr = reach.you;

  let fs = FS.replace("precision highp float;", "precision highp float;uniform float uPoolR,uVigR;");
  window.__departed = ${JSON.stringify(CLOTH_DEPARTURES)}.map(([from, to]) => {
    const n = fs.split(from).length - 1;
    fs = fs.split(from).join(to);
    return n;
  });
  window.__departedFS = fs;
  window.__departedDraws = 0;
  V.G = (0, eval)("(" + initGL.toString().replace("gl.FRAGMENT_SHADER,FS)", "gl.FRAGMENT_SHADER,window.__departedFS)") + ")")(V.gl);
  const light = ${JSON.stringify(LAMP_VARIANTS[LAMP_VARIANT])};
  const draw = drawCloth;
  drawCloth = (lx, ly, f, stops) => {
    const { gl } = V.G;
    const p = gl.getParameter(gl.CURRENT_PROGRAM);
    gl.uniform1f(gl.getUniformLocation(p, "uPoolR"), light.poolR * lamp.r);
    gl.uniform1f(gl.getUniformLocation(p, "uVigR"), light.vigR * lamp.r);
    draw(lx, ly, f, stops);
    window.__departedDraws++;
  };
})();`;

/** The departures took: each line swapped exactly once, and the cloth drawn with them. */
export async function expectDeparted(page: Page): Promise<void> {
  const seen = await page.evaluate(() => {
    const w = window as unknown as { __departed?: number[]; __departedDraws?: number; V: { G: { gl: WebGLRenderingContext } | null } };
    const gl = w.V.G?.gl;
    const p = gl?.getParameter(gl.CURRENT_PROGRAM);
    return {
      swapped: w.__departed ?? null,
      draws: w.__departedDraws ?? 0,
      uniforms: gl && p ? ["uPoolR", "uVigR"].filter((u) => gl.getUniformLocation(p, u) !== null) : [],
    };
  });
  expect(seen.swapped, "each of the mockup's two light lines swapped exactly once").toEqual(CLOTH_DEPARTURES.map(() => 1));
  expect(seen.uniforms, "the mockup's cloth takes the app's light uniforms").toEqual(["uPoolR", "uVigR"]);
  expect(seen.draws, "the mockup drew its cloth with the app's light").toBeGreaterThan(0);
}
