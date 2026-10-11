import { WithSkiaWeb } from "@shopify/react-native-skia/lib/module/web";
import { CANVASKIT_URL } from "@/lib/canvaskit";
import type { FeltCanvasProps } from "./feltCanvas";
import type { HandShadeProps } from "./feltReady";

const loadFeltCanvas = () => import("./skiaCanvases").then((m) => ({ default: m.FeltCanvas }));
const loadHandShadeCanvas = () => import("./skiaCanvases").then((m) => ({ default: m.HandShadeCanvas }));
const opts = { locateFile: (file: string) => CANVASKIT_URL + file };

export default function FeltSkiaBoundary(props: FeltCanvasProps) {
  return <WithSkiaWeb opts={opts} getComponent={loadFeltCanvas} componentProps={props} />;
}

export function HandShadeBoundary(props: HandShadeProps) {
  return <WithSkiaWeb opts={opts} getComponent={loadHandShadeCanvas} componentProps={props} />;
}
