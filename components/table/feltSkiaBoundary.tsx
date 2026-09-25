import { WithSkiaWeb } from "@shopify/react-native-skia/lib/module/web";
import { CANVASKIT_URL } from "@/lib/canvaskit";
import type { FeltCanvasProps } from "./feltCanvas";

const loadFeltCanvas = () => import("./feltCanvas");

export default function FeltSkiaBoundary(props: FeltCanvasProps) {
  return (
    <WithSkiaWeb
      opts={{ locateFile: (file: string) => CANVASKIT_URL + file }}
      getComponent={loadFeltCanvas}
      componentProps={props}
    />
  );
}
