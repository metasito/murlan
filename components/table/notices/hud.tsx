import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { A11yStatus, a11yGroup, a11yHidden } from "@/lib/a11y";
import { useTranslation } from "@/lib/i18n";
import { event, silence } from "@/lib/device/feedback";
import { urgentThresholdSeconds, CLOCK_RUNNING_OUT_SECONDS } from "@/components/turnTimerUi";
import { NoticeDot, NoticeText, TableNotice } from "../TableNotice";

/**
 * The name run, capped so a long username ellipsizes rather than pushing the
 * band wider than the felt has room for.
 */
const HUD_NAME_MAX_W = 88;

export function HudComboPill({ scale, play }: { scale: number; play: { name: string; combo: string } | null }) {
  const { t } = useTranslation();
  return (
    <TableNotice kind="hudCombo" tone="neutral" scale={scale}>
      {play === null ? (
        <NoticeText>{t("gameShared.emptyTable")}</NoticeText>
      ) : (
        <>
          <NoticeText maxWidth={HUD_NAME_MAX_W}>{play.name}</NoticeText>
          <NoticeText strong>{play.combo}</NoticeText>
        </>
      )}
    </TableNotice>
  );
}

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
    let sounding = false;
    const stop = () => {
      if (sounding) silence("clockRunningOut");
      sounding = false;
    };
    const id = setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (!sounding && remaining > 0 && remaining <= CLOCK_RUNNING_OUT_SECONDS) {
        sounding = true;
        event([{ kind: "clockRunningOut" }]);
      }
      if (remaining <= 0) {
        clearInterval(id);
        stop();
        onExpireRef.current?.();
      }
    }, 1000);
    return () => {
      clearInterval(id);
      stop();
    };
  }, [active, resetKey, seconds]);

  const threshold = urgentThresholdSeconds(seconds);
  const ember = lit && active && timeLeft > 0 && timeLeft <= CLOCK_RUNNING_OUT_SECONDS;
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
          <TableNotice kind="turn" tone={ember ? "urgent" : lit ? "lit" : "neutral"} scale={scale}>
            <NoticeDot testID="turn-chip-dot" />
            <NoticeText>{chipText}</NoticeText>
            {active && (
              <NoticeText strong warn={timeLeft <= threshold}>
                {timeLeft}
              </NoticeText>
            )}
          </TableNotice>
        </View>
      </View>
    </>
  );
}
