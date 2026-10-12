import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useAnimatedStyle, useFrameCallback, useSharedValue, type FrameInfo } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { event } from "@/lib/device/feedback";
import { traceOnset, useTraceSource } from "@/lib/e2eTrace";
import { holdGrey, linkHeld, type OwnLink } from "@/lib/ownLink";
import { Reconnect } from "@/lib/theme";
import { greyFilter, iosGrey } from "./linkGrey";
import type { LampRig } from "./useLampRig";

/** The mockup's `#turn` class for each state, which the parity trace names its onsets by. */
const PILL_CLASS: Record<OwnLink, string> = { up: "", dropped: "", reconnecting: "net", back: "ok", lost: "bad" };
// iOS draws `grayscale()` only through the SwiftUI filters `plugins/withSwiftUIFilters.js` turns on,
// and `brightness()` as a blend that cannot see the Skia felt: the felt greys in Skia, a scrim darkens.
const IOS = Platform.OS === "ios";

/** The table holding its breath while the viewer's own link is down: the grey, the freeze, the dimmed lamp and the chime back. */
export function useLinkHold(link: OwnLink, rig: Pick<LampRig, "freeze" | "setLevel">, missedInFlight = false) {
  const reduceMotion = usePrefersReducedMotion();
  const held = linkHeld(link);
  const grey = useSharedValue(holdGrey(link));
  const ramp = useSharedValue({ to: holdGrey(link), perMs: 0, started: true });
  const was = useRef(link);
  // Outlasts `held` until the grey has faded out: whatever iOS lifts over the scrim must stay lifted while it fades.
  const [greyed, setGreyed] = useState(held);
  if (greyed !== held && (held || reduceMotion)) setGreyed(held);

  useEffect(() => {
    const to = held ? Reconnect.grey : 0;
    if (reduceMotion) grey.value = to;
    ramp.value = { to, perMs: Reconnect.grey / (held ? Reconnect.greyIn : Reconnect.greyOut), started: false };
    rig.freeze(held ? 1 : 0);
  }, [held, reduceMotion, grey, ramp, rig]);

  const [step] = useState(() => (frame: FrameInfo) => {
    "worklet";
    const { to, perMs, started } = ramp.value;
    const g = grey.value;
    // The first frame's interval began before the change, so it only starts the ramp.
    if (!started) {
      ramp.value = { to, perMs, started: true };
      if (g === 0 && to === 0) scheduleOnRN(setGreyed, false);
      return;
    }
    if (g === to) return;
    const d = perMs * (frame.timeSincePreviousFrame ?? 0);
    const next = g < to ? Math.min(to, g + d) : Math.max(to, g - d);
    grey.value = next;
    if (next === 0) scheduleOnRN(setGreyed, false);
  });
  useFrameCallback(step);

  useEffect(() => {
    const before = was.current;
    was.current = link;
    if (before === link) return;
    if (linkHeld(link) && !linkHeld(before)) traceOnset("moment", "drop");
    if (PILL_CLASS[before] !== PILL_CLASS[link]) traceOnset("moment", `net-${PILL_CLASS[link]}`);
    if (link === "back") event([{ kind: "reconnected" }]);
  }, [link, rig]);

  const lost = link === "lost";
  const dimmed = useRef(false);
  useEffect(() => {
    if (dimmed.current === lost) return;
    dimmed.current = lost;
    rig.setLevel(lost ? Reconnect.lamp : 1, Reconnect.lampRate);
  }, [lost, rig]);

  useTraceSource(
    "grey",
    useCallback(() => grey.value, [grey])
  );
  const greyStyle = useAnimatedStyle(() => ({ filter: IOS ? iosGrey(grey.value).filter : greyFilter(grey.value) }));
  // RN hosts an iOS filter in SwiftUI, which insets its content by the safe area: the rail would leave the cutout's column.
  const edgeGreyStyle = useAnimatedStyle(() => (IOS ? {} : { filter: greyFilter(grey.value) }));
  const darkenStyle = useAnimatedStyle(() => ({ opacity: iosGrey(grey.value).darken }));
  return { grey, greyStyle, edgeGreyStyle, darkenStyle: IOS ? darkenStyle : null, held, greyed, frozen: held || missedInFlight };
}
