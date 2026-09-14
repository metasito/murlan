// Its own file, not chrome.tsx: the countdown ticks audibly, and `lib/sounds`
// reaches `expo-audio` at import time. chrome.tsx is the table's shared
// furniture, so folding this in hands a native audio module to every screen
// that draws a chip or a rail.
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { ChipDot, ChipText, TableChip } from "./chrome";
import { A11yStatus, a11yGroup, a11yHidden } from "@/lib/a11y";
import { useTranslation } from "@/lib/i18n";
import { playUrgentTick } from "@/lib/sounds";
import { urgentThresholdSeconds, URGENT_TICK_SECONDS } from "@/components/turnTimerUi";

// ─── Turn chip ────────────────────────────────────────────────────────────────
//
// The chip and its countdown are one component so the once-a-second tick
// re-renders a single chip and not the whole board — which, with hands of up to
// 18 cards, matters. It is also the only place that holds both halves of what a
// reader has to hear, since the seconds never leave this component's state.

export function TurnChip({
  seconds,
  active,
  resetKey,
  onExpire,
  scale,
  lit,
  chipText,
  spokenSeat,
}: {
  seconds: number;
  active: boolean;
  /** Restarts the countdown whenever it changes — one full clock per turn. */
  resetKey: string;
  onExpire?: () => void;
  scale: number;
  lit: boolean;
  /** The seat state as the chip draws it: short, uppercase, glanceable. */
  chipText: string;
  /** The same state as a sentence, which is what the group's name opens with. */
  spokenSeat: string;
}) {
  const { tn } = useTranslation();
  const [timeLeft, setTimeLeft] = useState(seconds);
  // Written after commit, never during render: the only reader is the interval
  // below, which fires a second later at the earliest.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  // Which clock is on the table. Anything that names a different one puts the
  // countdown back to full in the same render, so the first frame of a turn
  // never shows the last one's remainder.
  const clock = `${resetKey}|${seconds}|${active}`;
  const [shownClock, setShownClock] = useState(clock);
  if (clock !== shownClock) {
    setShownClock(clock);
    setTimeLeft(seconds);
  }

  useEffect(() => {
    if (!active) return;
    let remaining = seconds;
    const id = setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= URGENT_TICK_SECONDS && remaining >= 0) playUrgentTick();
      if (remaining <= 0) {
        clearInterval(id);
        onExpireRef.current?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [active, resetKey, seconds]);

  const threshold = urgentThresholdSeconds(seconds);
  // A live region speaks every time its text changes, so seconds in its label
  // are an interruption a second for the length of the manche. Two moments in a
  // turn are worth one; between them an empty label and an unchanged one are
  // the same silence. The group's name below is where the seconds stay
  // readable in between, and a name is spoken on landing rather than on change.
  //
  // Empty rather than unmounted or veiled: a region that arrives with its text
  // already in it announces nothing, so the node has to outlive the turn.
  const announce =
    active && (timeLeft === seconds || timeLeft === threshold)
      ? tn("gameTable.a11ySecondsLeft", timeLeft)
      : "";
  const label = active
    ? `${spokenSeat} ${tn("gameTable.a11ySecondsLeft", timeLeft)}`
    : spokenSeat;
  return (
    <>
      {/* Its own node, and outside the group rather than under it: a live
          region announces rather than being landed on (CLAUDE.md), and
          `accessible` seals every descendant into one leaf on iOS. */}
      <A11yStatus label={announce} />
      <View {...a11yGroup(label)}>
        {/* The chip draws the words the group's name already says. */}
        <View {...a11yHidden()}>
          <TableChip scale={scale} lit={lit}>
            <ChipDot testID="turn-chip-dot" scale={scale} lit={lit} />
            <ChipText scale={scale} lit={lit}>
              {chipText}
            </ChipText>
            {active && (
              <ChipText scale={scale} strong urgent={timeLeft <= threshold}>
                {timeLeft}
              </ChipText>
            )}
          </TableChip>
        </View>
      </View>
    </>
  );
}
