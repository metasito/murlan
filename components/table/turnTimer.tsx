// Its own file, not chrome.tsx: the countdown ticks audibly, and `lib/sounds`
// reaches `expo-audio` at import time. chrome.tsx is the table's shared
// furniture, so folding this in hands a native audio module to every screen
// that draws a chip or a rail.
import { useEffect, useRef, useState } from "react";
import { ChipText } from "./chrome";
import { useTranslation } from "@/lib/i18n";
import { playUrgentTick } from "@/lib/sounds";
import { urgentThresholdSeconds, URGENT_TICK_SECONDS } from "@/components/gameTableModel";

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

  useEffect(() => {
    if (!active) {
      setTimeLeft(seconds);
      return;
    }
    let remaining = seconds;
    setTimeLeft(remaining);
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

  if (!active) return null;
  const urgent = timeLeft <= urgentThresholdSeconds(seconds);
  return (
    <ChipText
      scale={scale}
      strong
      urgent={urgent}
      accessibilityLiveRegion="polite"
      accessibilityLabel={tn("gameTable.a11ySecondsLeft", timeLeft)}
    >
      {timeLeft}
    </ChipText>
  );
}
