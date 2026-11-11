import { LoadSkiaWeb, WithSkiaWeb } from "@shopify/react-native-skia/lib/module/web";
import { CANVASKIT_URL } from "@/lib/canvaskit";
import type { FeltCanvasProps } from "./feltCanvas";
import type { HandShadeProps } from "./feltReady";

const loadFeltCanvas = () =>
  import("./skiaCanvases").then((m) => ({ default: (props: FeltCanvasProps) => <m.FeltCanvas {...props} Ends={m.EndB} Pool={m.FeltPool} /> }));
const loadHandShadeCanvas = () => import("./skiaCanvases").then((m) => ({ default: m.HandShadeCanvas }));
const opts = { locateFile: (file: string) => CANVASKIT_URL + file };

let loading: Promise<boolean> | undefined;

/** Whether CanvasKit loaded. A fetch that fails is an answer here, never an error thrown to a boundary: React logs every error one catches. */
export const canvasKitLoads = (): Promise<boolean> => (loading ??= LoadSkiaWeb(opts).then(() => true, () => false));

export default function FeltSkiaBoundary(props: FeltCanvasProps) {
  return <WithSkiaWeb opts={opts} getComponent={loadFeltCanvas} componentProps={props} />;
}

export function HandShadeBoundary(props: HandShadeProps) {
  return <WithSkiaWeb opts={opts} getComponent={loadHandShadeCanvas} componentProps={props} />;
}
