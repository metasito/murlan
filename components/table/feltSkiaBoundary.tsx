import { WithSkiaWeb } from "@shopify/react-native-skia/lib/module/web";
import type { FeltCanvasProps } from "./feltCanvas";

/** The `canvaskit-wasm` @shopify/react-native-skia pins (tests/ui-rules/feltWeave.test.ts). */
export const CANVASKIT_VERSION = "0.41.0";
const CANVASKIT = `https://cdn.jsdelivr.net/npm/canvaskit-wasm@${CANVASKIT_VERSION}/bin/full/`;

export default function FeltSkiaBoundary(props: FeltCanvasProps) {
  return (
    <WithSkiaWeb
      opts={{ locateFile: (file: string) => CANVASKIT + file }}
      getComponent={() => import("./feltCanvas")}
      componentProps={props}
    />
  );
}
