import { diag } from "./index";

const TICK_MS = 8;
const LAG_MS = 34;

export function startJsLag(): () => void {
  let last = performance.now();
  let n = 0;
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    const t = performance.now();
    if (t - last >= LAG_MS) diag({ k: "jsLag", t, dt: t - last });
    last = t;
    n++;
    timer = setTimeout(tick, TICK_MS);
  };
  timer = setTimeout(tick, TICK_MS);
  return () => {
    clearTimeout(timer);
    diag({ k: "jsTicks", t: performance.now(), n });
  };
}
