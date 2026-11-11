// tests/e2e/feltGlsl.spec.ts — the fallback felt's WebGL shaders, derived from the Skia cloth by
// text swaps, compile and link in Chromium's WebGL; and the cloth lit from the weave's planes
// matches the one-pass cloth to one 8-bit level, as the Skia twin does in feltDeferred.test.ts.
import { test, expect } from "./fixtures";
import { CLOTH_GLSL, LIT_GLSL, QUAD_GLSL, WEAVE_GLSL, WEAVE_PLANES, clothUniforms, weaveUniforms } from "../../components/table/feltShader.ts";
import { LIGHT_ABOVE, lightUniforms } from "../../components/table/lampRig.ts";
import { FeltGradients } from "../../lib/tokens.ts";

const PX: [number, number] = [2, 2];
const SIZE = [1748, 804] as const;
const LAMPS: [number, number][] = [
  [437, 362],
  [784, 201],
  [90, 201],
];

test("the fallback's cloth, weave and lit cloth link, and the lit cloth matches the one pass", async ({ page }) => {
  await page.setContent("<!doctype html><body></body>");
  const k = Math.min(...PX);
  const cases = LAMPS.map(([x, y]) => ({ ...clothUniforms(FeltGradients.verde, k), uLamp: [x, y - LIGHT_ABOVE], uFlare: 0, ...lightUniforms(1) }));
  const weave = Array.from({ length: WEAVE_PLANES }, (_, plane) => weaveUniforms(k, plane));
  const out = await page.evaluate(
    ({ QUAD_GLSL, CLOTH_GLSL, WEAVE_GLSL, LIT_GLSL, SIZE: [w, h], PX, cases, weave }) => {
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      const gl = cv.getContext("webgl", { premultipliedAlpha: true, antialias: false });
      if (!gl) return { logs: ["no webgl"], diffs: [], lit: [] };
      const logs: string[] = [];
      const program = (name: string, fragment: string) => {
        const p = gl.createProgram()!;
        for (const [type, src] of [[gl.VERTEX_SHADER, QUAD_GLSL], [gl.FRAGMENT_SHADER, fragment]] as const) {
          const s = gl.createShader(type)!;
          gl.shaderSource(s, src);
          gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) logs.push(`${name}: ${gl.getShaderInfoLog(s)}`);
          gl.attachShader(p, s);
        }
        gl.bindAttribLocation(p, 0, "a");
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) logs.push(`${name} link: ${gl.getProgramInfoLog(p)}`);
        return p;
      };
      const cloth = program("cloth", CLOTH_GLSL);
      const weaveP = program("weave", WEAVE_GLSL);
      const lit = program("lit", LIT_GLSL);
      if (logs.length) return { logs, diffs: [], lit: [] };
      const set = (p: WebGLProgram, u: Record<string, number | number[]>) => {
        gl.useProgram(p);
        for (const [n, v] of Object.entries({ ...u, uRes: [w, h], uPx: PX })) {
          const at = gl.getUniformLocation(p, n);
          if (typeof v === "number") gl.uniform1f(at, v);
          else if (v.length === 2) gl.uniform2fv(at, v);
          else gl.uniform3fv(at, v);
        }
      };
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.viewport(0, 0, w, h);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      const planes = weave.map((u) => {
        const t = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, t);
        for (const f of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, f, gl.NEAREST);
        for (const m of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, m, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        set(weaveP, u);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return t;
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const read = () => {
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      const diffs: number[] = [];
      const litShare: number[] = [];
      for (const u of cases) {
        set(cloth, u);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const a = read();
        set(lit, u);
        planes.forEach((t, i) => {
          gl.activeTexture(gl.TEXTURE0 + i);
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.uniform1i(gl.getUniformLocation(lit, `uG${i}`), i);
        });
        gl.activeTexture(gl.TEXTURE0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const b = read();
        let max = 0;
        let covered = 0;
        for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
        for (let i = 3; i < a.length; i += 4) if (a[i] === 255 && a[i - 1] + a[i - 2] + a[i - 3] > 24) covered++;
        diffs.push(max);
        litShare.push(covered / (w * h));
      }
      return { logs, diffs, lit: litShare };
    },
    { QUAD_GLSL, CLOTH_GLSL, WEAVE_GLSL, LIT_GLSL, SIZE, PX, cases, weave }
  );
  expect(out.logs).toEqual([]);
  expect(out.diffs).toHaveLength(LAMPS.length);
  for (const d of out.diffs) expect(d).toBeLessThanOrEqual(1);
  for (const share of out.lit) expect(share).toBeGreaterThan(0.5);
});
