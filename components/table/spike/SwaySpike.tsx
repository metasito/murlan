import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { keyframes, LOOP_SECONDS, opacityAt, SWAY_AMPLITUDE } from "./swayTable";

const W = 874;
const H = 402;
const FRAMES = keyframes();

type Driver = "static" | "css" | "live" | "paused";
type Api = {
  setDriver(d: Driver, offset?: number): Promise<void>;
  setDpr(): number;
  setLayers(n: 1 | 2): Promise<void>;
  setPool(on: boolean): Promise<void>;
  setBlend(mode: string): Promise<void>;
  clock(): { start: number; paused: number };
  loopSeconds: number;
  amplitude: number;
};

function paint(c: HTMLCanvasElement | null, seed: number, flat?: [number, number, number]) {
  if (!c) return;
  const k = window.devicePixelRatio;
  c.width = Math.round(W * k);
  c.height = Math.round(H * k);
  const x = c.getContext("2d")!;
  if (flat) {
    x.fillStyle = `rgb(${flat.join(",")})`;
    x.fillRect(0, 0, c.width, c.height);
    return;
  }
  const img = x.createImageData(c.width, c.height);
  let s = seed;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const v = 40 + ((s >>> 24) % 60);
    img.data[i] = v * 0.3;
    img.data[i + 1] = v;
    img.data[i + 2] = v * 0.5;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
}

const Canvas = ({ id, seed, flat }: { id: string; seed: number; flat?: [number, number, number] }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => paint(ref.current, seed, flat), [seed, flat]);
  // eslint-disable-next-line react/no-unknown-property
  return <canvas ref={ref} id={id} style={{ position: "absolute", left: 0, top: 0, width: W, height: H }} />;
};

export function SwaySpike() {
  const [driver, setDriver] = useState<Driver>("static");
  const [offset, setOffset] = useState(0);
  const [layers, setLayers] = useState<1 | 2>(2);
  const [pool, setPool] = useState(false);
  const [blend, setBlend] = useState("plus-lighter");
  const clock = useRef({ start: 0, paused: 0 });
  const bRef = useRef<View>(null);
  const flat = pool || blend !== "plus-lighter" ? ([100, 100, 100] as [number, number, number]) : undefined;

  useEffect(() => {
    const done = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const api: Api = {
      async setDriver(d, off) {
        if (off !== undefined) setOffset(off);
        setDriver(d);
        await done();
      },
      setDpr: () => window.devicePixelRatio,
      async setLayers(n) {
        setLayers(n);
        await done();
      },
      async setPool(on) {
        setPool(on);
        await done();
      },
      async setBlend(m) {
        setBlend(m);
        await done();
      },
      clock: () => clock.current,
      loopSeconds: LOOP_SECONDS,
      amplitude: SWAY_AMPLITUDE,
    };
    (window as unknown as { spike: Api }).spike = api;
  }, []);

  useEffect(() => {
    if (driver !== "live") return;
    let raf = 0;
    const el = () => bRef.current as unknown as HTMLElement;
    const step = () => {
      el().style.opacity = String(opacityAt((performance.now() - clock.current.start) / 1000));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [driver]);

  const css = driver === "css" || driver === "paused";
  return (
    <View style={{ width: W, height: H, backgroundColor: "#000", overflow: "hidden" }} testID="spike-root">
      <Canvas id="a" seed={1} flat={flat} />
      {layers === 2 ? (
        <Animated.View
          ref={bRef as never}
          nativeID="b"
          style={[
            { position: "absolute", left: 0, top: 0, width: W, height: H, opacity: driver === "static" ? 0.5 : driver === "live" ? opacityAt((performance.now() - clock.current.start) / 1000) : undefined },
            (css && {
              animationName: FRAMES,
              animationDuration: `${LOOP_SECONDS}s`,
              animationIterationCount: "infinite",
              animationTimingFunction: "linear",
              animationDelay: `${-offset}s`,
              animationPlayState: driver === "paused" ? "paused" : "running",
            }) as never,
          ]}
        >
          <Canvas id="bc" seed={2} flat={flat ? ([180, 180, 180] as [number, number, number]) : undefined} />
        </Animated.View>
      ) : null}
      {pool ? (
        <Animated.View
          nativeID="pool"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 760,
            height: 760,
            borderRadius: 380,
            backgroundColor: "rgba(128,128,128,0.5)",
            mixBlendMode: blend as never,
            animationName: { from: { transform: [{ translateX: -300 }, { translateY: -150 }] }, to: { transform: [{ translateX: 200 }, { translateY: -100 }] } },
            animationDuration: "2s",
            animationIterationCount: "infinite",
            animationDirection: "alternate",
            animationTimingFunction: "ease-out",
          } as never}
        />
      ) : null}
    </View>
  );
}
