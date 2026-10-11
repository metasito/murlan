import { WithSkiaWeb } from "@shopify/react-native-skia/lib/module/web";
import { CANVASKIT_URL } from "@/lib/canvaskit";
import type { HandShadeProps } from "./feltReady";

const loadHandShadeCanvas = () => import("./handShadeCanvas");

export default function HandShadeBoundary(props: HandShadeProps) {
  return (
    <WithSkiaWeb
      opts={{ locateFile: (file: string) => CANVASKIT_URL + file }}
      getComponent={loadHandShadeCanvas}
      componentProps={props}
    />
  );
}
