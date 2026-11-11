import { E2E_FAST } from "@/lib/e2eConfig";

const SOFTWARE_GL = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i;

let onGpu: boolean | undefined;

/** The felt's shader covers the table: on a software rasteriser a swaying lamp takes the main thread. */
export function drawsOnGpu(): boolean {
  if (onGpu !== undefined) return onGpu;
  const e2e = globalThis as { murlanSkiaOnSoftware?: boolean };
  if (E2E_FAST && e2e.murlanSkiaOnSoftware) return (onGpu = true);
  const gl = document.createElement("canvas").getContext("webgl", { failIfMajorPerformanceCaveat: true });
  if (!gl) return (onGpu = false);
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return (onGpu = !SOFTWARE_GL.test(renderer));
}
