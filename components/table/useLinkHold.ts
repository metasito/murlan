import { useCallback, useEffect, useRef, useState } from "react";
import { useAnimatedStyle, useSharedValue, type FrameInfo } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { event } from "@/lib/device/feedback";
import { traceOnset, useTraceSource } from "@/lib/e2eTrace";
import { stampChange, startOf, useDuring } from "@/lib/motion";
import { holdGrey, linkHeld, type OwnLink } from "@/lib/ownLink";
import { viewFilterGrey } from "@/lib/platform";
import { Reconnect } from "@/lib/theme";
import { greyFilter, iosGrey } from "./linkGrey";
import type { LampRig } from "./useLampRig";

/** The mockup's `#turn` class for each state, which the parity trace names its onsets by. */
const PILL_CLASS: Record<OwnLink, string> = { up: "", dropped: "", reconnecting: "net", back: "ok", lost: "bad" };

/** The table holding its breath while the viewer's own link is down: the grey, the freeze, the dimmed lamp and the chime back. */
export function useLinkHold(link: OwnLink, rig: Pick<LampRig, "freeze" | "hold">, missedInFlight = false) {
  const reduceMotion = usePrefersReducedMotion();
  const held = linkHeld(link);
  const grey = useSharedValue(holdGrey(link));
  const ramp = useSharedValue({ to: holdGrey(link), perMs: 0, startedAt: 0, from: holdGrey(link), at: 0 });
  const was = useRef(link);
  // Outlasts `held` until the grey has faded out: whatever iOS lifts over the scrim must stay lifted while it fades.
  const [greyed, setGreyed] = useState(held);
  if (greyed !== held && (held || reduceMotion)) setGreyed(held);

  const [step] = useState(() => (frame: FrameInfo): boolean => {
    "worklet";
    const { to, perMs, startedAt, from, at } = ramp.value;
    const first = startedAt < 0;
    const origin = first ? startOf(frame.timestamp, at) : startedAt;
    const start = first ? grey.value : from;
    if (first) ramp.value = { to, perMs, startedAt: origin, from: start, at };
    const d = perMs * (frame.timestamp - origin);
    const next = start < to ? Math.min(to, start + d) : Math.max(to, start - d);
    grey.value = next;
    if (next === 0) scheduleOnRN(setGreyed, false);
    return next !== to;
  });
  const wake = useDuring(step);

  const rampedFor = useRef(`${held}${reduceMotion}`);
  useEffect(() => {
    rig.freeze(held ? 1 : 0);
    if (rampedFor.current === `${held}${reduceMotion}`) return;
    rampedFor.current = `${held}${reduceMotion}`;
    const to = held ? Reconnect.grey : 0;
    if (reduceMotion) grey.set(to);
    ramp.set({ to, perMs: Reconnect.grey / (held ? Reconnect.greyIn : Reconnect.greyOut), startedAt: -1, from: 0, at: stampChange() });
    wake();
  }, [held, reduceMotion, grey, ramp, rig, wake]);

  useEffect(() => {
    const before = was.current;
    was.current = link;
    if (before === link) return;
    if (linkHeld(link) && !linkHeld(before)) traceOnset("moment", "drop");
    if (PILL_CLASS[before] !== PILL_CLASS[link]) traceOnset("moment", `net-${PILL_CLASS[link]}`);
    if (link === "back") event([{ kind: "reconnected" }]);
  }, [link, rig]);

  const lost = link === "lost";
  useEffect(() => {
    rig.hold("link", lost ? Reconnect.lamp : null, Reconnect.lampRate);
  }, [lost, rig]);

  useTraceSource(
    "grey",
    useCallback(() => grey.value, [grey])
  );
  const greyStyle = useAnimatedStyle(() => ({ filter: viewFilterGrey ? greyFilter(grey.value) : iosGrey(grey.value).filter }));
  // RN hosts an iOS filter in SwiftUI, which insets its content by the safe area: the rail would leave the cutout's column.
  const edgeGreyStyle = useAnimatedStyle(() => (viewFilterGrey ? { filter: greyFilter(grey.value) } : {}));
  const darkenStyle = useAnimatedStyle(() => ({ opacity: iosGrey(grey.value).darken }));
  return { grey, greyStyle, edgeGreyStyle, darkenStyle: viewFilterGrey ? null : darkenStyle, held, greyed, frozen: held || missedInFlight };
}
