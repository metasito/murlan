// Which edge the device's cutout is on, followed live.
//
// Its own module rather than a helper inside one screen: the table and the
// result board both lay a column against that edge, and two subscriptions
// derived separately are two that can answer differently on the same rotation.
import { useEffect, useState } from "react";
import * as ScreenOrientation from "expo-screen-orientation";
import { LANDSCAPE_LEFT, railSideFor, type RailSide } from "@/components/gameTableModel";

/**
 * `sideInset` is the larger of the two horizontal insets — the cutout's own,
 * whichever side it is reported on. `railSideFor` decides the rest: the
 * landscape lock permits both directions, so a screen that assumed the left
 * put its rail opposite the cutout on half of them (#400).
 */
export function useRailSide(sideInset: number): RailSide {
  const [rotation, setRotation] = useState<number>(LANDSCAPE_LEFT);

  useEffect(() => {
    let mounted = true;
    const follow = (o: ScreenOrientation.Orientation) => {
      if (mounted) setRotation(o);
    };
    ScreenOrientation.getOrientationAsync().then(follow).catch(() => {});
    const sub = ScreenOrientation.addOrientationChangeListener((e) =>
      follow(e.orientationInfo.orientation)
    );
    return () => {
      mounted = false;
      // `removeOrientationChangeListener` throws on a subscription with no
      // `remove`, which is what the native module hands back untethered.
      sub?.remove?.();
    };
  }, []);

  return railSideFor(sideInset, rotation);
}
