// Its own file, not chrome.tsx: the countdown ticks audibly, and `lib/sounds`
// reaches `expo-audio` at import time. chrome.tsx is the table's shared
// furniture, so folding this in hands a native audio module to every screen
// that draws a chip or a rail.
import { useEffect, useRef, useState } from "react";
import { ChipText } from "./chrome";
import { A11yStatus } from "@/lib/a11y";
import { useTranslation } from "@/lib/i18n";
import { playUrgentTick } from "@/lib/sounds";
import { urgentThresholdSeconds, URGENT_TICK_SECONDS } from "@/components/turnTimerUi";

// ─── Turn countdown ───────────────────────────────────────────────────────────
//
// Its own component so the once-a-second tick re-renders a single <TableText> and
// not the whole board — which, with hands of up to 18 cards, matters.

export function TurnTimer({
  seconds,
  active,
  resetKey,
  onExpire,
  scale,
}: {
  seconds: number;
  active: boolean;
  /** Restarts the countdown whenever it changes — one full clock per turn. */
  resetKey: string;
  onExpire?: () => void;
  scale: number;
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
  // the same silence. Whose turn it is is `describeTableForA11y`'s sentence.
  //
  // Empty rather than unmounted or veiled: a region that arrives with its text
  // already in it announces nothing, so the node has to outlive the turn.
  const announce =
    active && (timeLeft === seconds || timeLeft === threshold)
      ? tn("gameTable.a11ySecondsLeft", timeLeft)
      : "";
  return (
    <>
      {/* Its own node, never the countdown: a live region announces rather
          than being landed on (CLAUDE.md). */}
      <A11yStatus label={announce} />
      {active && (
        // Unnamed by choice: the only DOM role that would carry a name here,
        // `timer`, inherits `polite` from `status` — the per-second
        // announcement back again (#1028).
        <ChipText scale={scale} strong urgent={timeLeft <= threshold}>
          {timeLeft}
        </ChipText>
      )}
    </>
  );
}
