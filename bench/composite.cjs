// Synthetic: what each way of moving the lamp's light costs, in the same Chromium/SwiftShader the e2e suite uses.
const { chromium } = require("/workspace/murlan/node_modules/playwright");

const PAGE = `<!doctype html><html><head><style>
html,body{margin:0;background:#000;overflow:hidden}
canvas{position:absolute;left:0;top:0;width:874px;height:402px}
#b{will-change:opacity}
@keyframes sway{0%{opacity:0}50%{opacity:1}100%{opacity:0}}
.swaying #b{animation:sway 7.5s cubic-bezier(.37,0,.63,1) infinite}
#pool{position:absolute;left:0;top:0;width:760px;height:760px;border-radius:50%;background:radial-gradient(circle,rgba(255,220,160,.5),rgba(255,220,160,0) 70%);mix-blend-mode:plus-lighter;will-change:transform;display:none}
@keyframes glide{0%{transform:translate(-300px,-150px)}100%{transform:translate(200px,-100px)}}
.gliding #pool{display:block;animation:glide 2s ease-out infinite alternate}
</style></head><body><canvas id=a></canvas><canvas id=b></canvas><div id=pool></div><script>
let dpr=devicePixelRatio,W=874*dpr|0,H=402*dpr|0;
function noiseCanvas(c,seed){c.width=W;c.height=H;const x=c.getContext('2d');const img=x.createImageData(W,H);let s=seed;for(let i=0;i<img.data.length;i+=4){s=(s*1664525+1013904223)>>>0;const v=40+(s>>>24)%60;img.data[i]=v*.3;img.data[i+1]=v;img.data[i+2]=v*.5;img.data[i+3]=255}x.putImageData(img,0,0)}
window.setup=(mode,area,k)=>{if(k){dpr=k;W=874*k|0;H=402*k|0;}
  const a=document.getElementById('a'),b=document.getElementById('b');
  if(mode==='pool'){noiseCanvas(a,1);b.style.display='none';document.body.className='gliding';return}
  if(mode==='static'||mode==='css'){noiseCanvas(a,1);noiseCanvas(b,2);if(mode==='css')document.body.className='swaying';return}
  b.style.display='none';a.width=W;a.height=H;
  const gl=a.getContext('webgl2');
  const vs='#version 300 es\\nin vec2 p;void main(){gl_Position=vec4(p,0,1);}';
  const fsMix='#version 300 es\\nprecision highp float;uniform sampler2D t0,t1;uniform float w;out vec4 o;void main(){ivec2 q=ivec2(gl_FragCoord.xy);o=mix(texelFetch(t0,q,0),texelFetch(t1,q,0),w);}';
  const fsLit='#version 300 es\\nprecision highp float;uniform sampler2D t0,t1;uniform vec2 L;uniform float R,F;out vec4 o;void main(){ivec2 q=ivec2(gl_FragCoord.xy);vec4 g0=texelFetch(t0,q,0),g1=texelFetch(t1,q,0);vec2 n=g0.xy*2.-1.;vec2 d=gl_FragCoord.xy-L;float r=length(d);vec3 l=normalize(vec3(-d,R*.4));float diff=max(0.,dot(normalize(vec3(n,1.)),l));float pool=pow(clamp(1.-r/R,0.,1.),1.6);float sh=pow(max(0.,dot(reflect(-l,vec3(n,1.)),vec3(0,0,1))),12.)*g1.z;vec3 alb=vec3(.12,.36,.2);vec3 c=alb*(g1.x+g1.y*diff*pool)+sh*pool+vec3(1.,.78,.45)*pow(1.-clamp(r/(R+F*120.),0.,1.),2.)*(.14+.35*F);o=vec4(c,1);}';
  const prog=(fs)=>{const p=gl.createProgram();for(const[t,s]of[[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){const sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw gl.getShaderInfoLog(sh);gl.attachShader(p,sh)}gl.bindAttribLocation(p,0,'p');gl.linkProgram(p);return p};
  const P=prog(mode.startsWith('lit')?fsLit:fsMix);gl.useProgram(P);
  const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  const tex=(u,unit,seed)=>{const d=new Uint8Array(W*H*4);let s=seed;for(let i=0;i<d.length;i++){s=(s*1664525+1013904223)>>>0;d[i]=s>>>24}const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,W,H,0,gl.RGBA,gl.UNSIGNED_BYTE,d);gl.uniform1i(gl.getUniformLocation(P,u),unit)};
  tex('t0',0,1);tex('t1',1,2);
  const every=mode.includes('20hz')?3:mode.includes('30hz')?2:1;
  if(area<1){gl.enable(gl.SCISSOR_TEST);const w=Math.round(W*Math.sqrt(area)),h=Math.round(H*Math.sqrt(area));gl.scissor((W-w)>>1,(H-h)>>1,w,h)}
  let f=0;const loop=(t)=>{if(f++%every===0){const ph=t/1000*.84;gl.uniform1f(gl.getUniformLocation(P,'w'),.5+.5*Math.sin(ph));gl.uniform2f(gl.getUniformLocation(P,'L'),W/2+Math.sin(ph)*20*dpr,H*.6);gl.uniform1f(gl.getUniformLocation(P,'R'),380*dpr);gl.uniform1f(gl.getUniformLocation(P,'F'),0);gl.drawArrays(gl.TRIANGLES,0,3)}requestAnimationFrame(loop)};requestAnimationFrame(loop);
};
</script></body></html>`;

const fs = require("fs");
function procCpu() {
  let t = 0;
  for (const p of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(p)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${p}/cmdline`, "utf8");
      if (!/chrom/i.test(cmd)) continue;
      const f = fs.readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" ");
      t += (Number(f[11]) + Number(f[12])) / 100;
    } catch {}
  }
  return t;
}
(async () => {
  const dprs = (process.env.DPRS ?? "1,3").split(",").map(Number);
  const modes = (process.env.MODES ?? "static,css,mix-20hz,mix-60hz,lit-60hz,lit-60hz-dirty40").split(",");
  const browser = await chromium.launch();
  for (const dpr of dprs) {
    for (const mode of modes) {
      const runs = [];
      for (let r = 0; r < 3; r++) {
        const ctx = await browser.newContext({ viewport: { width: 874, height: 402 }, deviceScaleFactor: dpr });
        const page = await ctx.newPage();
        await page.setContent(PAGE);
        await page.evaluate(([m, a]) => window.setup(m, a), [mode.replace(/-dirty40|@k[\d.]+/g, ""), mode.includes("dirty40") ? 0.4 : 1, mode.includes("@k") ? Number(mode.split("@k")[1]) : 0]);
        const cdp = await ctx.newCDPSession(page);
        await cdp.send("Performance.enable");
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.waitForTimeout(1000);
        const m = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
        // Presented frames counted from the compositor's own frame stream: our page adds no rAF of its own in the css case.
        await cdp.send("Tracing.start", { categories: "disabled-by-default-devtools.timeline.frame,devtools.timeline", transferMode: "ReturnAsStream" }).catch(() => {});
        const cpu0 = procCpu();
        const a = await m();
        await page.waitForTimeout(3000);
        const b = await m();
        const cpu1 = procCpu();
        const events = [];
        await new Promise((res) => {
          cdp.on("Tracing.tracingComplete", async ({ stream }) => {
            let data = "";
            for (;;) {
              const { data: d, eof } = await cdp.send("IO.read", { handle: stream });
              data += d;
              if (eof) break;
            }
            try {
              const j = JSON.parse(data);
              events.push(...(j.traceEvents ?? j));
            } catch {}
            res();
          });
          cdp.send("Tracing.end");
        });
        const s = b.Timestamp - a.Timestamp;
        const frames = events.filter((e) => e.name === "DrawFrame").length;
        const gpuTask = events.filter((e) => e.name === "GPUTask" && e.dur).reduce((n, e) => n + e.dur, 0) / 1000;
        runs.push({ cpu: ((cpu1 - cpu0) * 1000) / (b.Timestamp - a.Timestamp), task: ((b.TaskDuration - a.TaskDuration) * 1000) / s, script: ((b.ScriptDuration - a.ScriptDuration) * 1000) / s, frames: frames / 3 });
        await ctx.close();
      }
      const med = (k) => runs.map((r) => r[k]).sort((x, y) => x - y)[1].toFixed(0);
      console.log(`dpr ${dpr} ${mode.padEnd(18)} mainTaskMsPerS ${med("task").padStart(4)} scriptMsPerS ${med("script").padStart(4)} drawFramesPerS ${med("frames")} allChromiumCpuMsPerS ${med("cpu")}  runs ${JSON.stringify(runs.map((r) => Math.round(r.task)))}`);
    }
  }
  await browser.close();
})();
