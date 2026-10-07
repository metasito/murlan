import { useCallback, useEffect, useRef } from "react";
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { event } from "@/lib/device/feedback";
import { traceOnset, useTraceSource } from "@/lib/e2eTrace";
import type { OwnLink } from "@/lib/ownLink";
import { Reconnect } from "@/lib/theme";
import type { LampRig } from "./useLampRig";

const HELD: ReadonlySet<OwnLink> = new Set(["dropped", "reconnecting", "lost"]);
/** The mockup's `#turn` class for each state, which the parity trace names its onsets by. */
const PILL_CLASS: Record<OwnLink, string> = { up: "", dropped: "", reconnecting: "net", back: "ok", lost: "bad" };
const GREY_VISIBLE = 0.01;

export function greyFilter(g: number): string | undefined {
  "worklet";
  return g > GREY_VISIBLE ? `grayscale(${g}) brightness(${1 - Reconnect.darken * g})` : undefined;
}

/** The table holding its breath while the viewer's own link is down: the grey, the freeze, the dimmed lamp and the chime back. */
export function useLinkHold(link: OwnLink, rig: Pick<LampRig, "freeze" | "setLevel">) {
  const reduceMotion = usePrefersReducedMotion();
  const held = HELD.has(link);
  const grey = useSharedValue(held ? Reconnect.grey : 0);
  const was = useRef(link);

  useEffect(() => {
    const target = held ? Reconnect.grey : 0;
    grey.value = reduceMotion
      ? target
      : withTiming(target, { duration: held ? Reconnect.greyIn : Reconnect.greyOut, easing: Easing.linear });
    rig.freeze(held ? 1 : 0);
  }, [held, reduceMotion, grey, rig]);

  useEffect(() => {
    const before = was.current;
    was.current = link;
    if (before === link) return;
    if (PILL_CLASS[before] !== PILL_CLASS[link]) traceOnset("moment", `net-${PILL_CLASS[link]}`);
    if (link === "lost") rig.setLevel(Reconnect.lamp, Reconnect.lampRate);
    else if (before === "lost") rig.setLevel(1, Reconnect.lampRate);
    if (link === "back") event([{ kind: "reconnected" }]);
  }, [link, rig]);

  useTraceSource(
    "grey",
    useCallback(() => grey.value, [grey])
  );
  const greyStyle = useAnimatedStyle(() => ({ filter: greyFilter(grey.value) }));
  return { greyStyle, frozen: held };
}
