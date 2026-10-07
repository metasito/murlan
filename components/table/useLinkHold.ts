import { useCallback, useEffect, useRef, useState } from "react";
import { useAnimatedStyle, useFrameCallback, useSharedValue, type FrameInfo } from "react-native-reanimated";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { event } from "@/lib/device/feedback";
import { traceOnset, useTraceSource } from "@/lib/e2eTrace";
import { linkHeld, type OwnLink } from "@/lib/ownLink";
import { Reconnect } from "@/lib/theme";
import type { LampRig } from "./useLampRig";

/** The mockup's `#turn` class for each state, which the parity trace names its onsets by. */
const PILL_CLASS: Record<OwnLink, string> = { up: "", dropped: "", reconnecting: "net", back: "ok", lost: "bad" };
const GREY_VISIBLE = 0.01;

export function greyFilter(g: number): string {
  "worklet";
  return g > GREY_VISIBLE ? `grayscale(${g}) brightness(${1 - Reconnect.darken * g})` : "none";
}

/** The table holding its breath while the viewer's own link is down: the grey, the freeze, the dimmed lamp and the chime back. */
export function useLinkHold(link: OwnLink, rig: Pick<LampRig, "freeze" | "setLevel">, missedInFlight = false) {
  const reduceMotion = usePrefersReducedMotion();
  const held = linkHeld(link);
  const grey = useSharedValue(held ? Reconnect.grey : 0);
  const ramp = useSharedValue({ to: held ? Reconnect.grey : 0, perMs: 0 });
  const was = useRef(link);

  useEffect(() => {
    const to = held ? Reconnect.grey : 0;
    if (reduceMotion) grey.value = to;
    ramp.value = { to, perMs: Reconnect.grey / (held ? Reconnect.greyIn : Reconnect.greyOut) };
    rig.freeze(held ? 1 : 0);
  }, [held, reduceMotion, grey, ramp, rig]);

  const [step] = useState(() => (frame: FrameInfo) => {
    "worklet";
    const { to, perMs } = ramp.value;
    const g = grey.value;
    if (g === to) return;
    const d = perMs * (frame.timeSincePreviousFrame ?? 0);
    grey.value = g < to ? Math.min(to, g + d) : Math.max(to, g - d);
  });
  useFrameCallback(step);

  useEffect(() => {
    const before = was.current;
    was.current = link;
    if (before === link) return;
    if (linkHeld(link) && !linkHeld(before)) traceOnset("moment", "drop");
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
  return { greyStyle, frozen: held || missedInFlight };
}
