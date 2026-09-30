import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "@/lib/i18n";
import { NoticeText, TableNotice } from "../TableNotice";
import { markAt, mockupPx } from "../noticeModel";

/** Any width past the widest mark: the slot only centres it. */
const MARK_SLOT = 120;

/**
 * A pass leaves no trace on the felt, so this mark is the only thing that says a seat is out of the
 * current round. It stands until somebody plays, which is when `passedSeats` (flightPhysics.ts)
 * stops returning that seat. `disc` is the box it is placed against.
 */
export function PassedMark({ side, disc, scale }: { side: "top" | "side"; disc: number; scale: number }) {
  const { t } = useTranslation();
  const at = markAt(side, scale);
  const slot = mockupPx(MARK_SLOT, scale);
  return (
    <View pointerEvents="none" style={[styles.slot, { width: slot, left: disc / 2 + at.x - slot / 2, top: disc / 2 + at.y }]}>
      <TableNotice kind="passed" tone="neutral" scale={scale}>
        <NoticeText>{t("gameShared.passedLabel")}</NoticeText>
      </TableNotice>
    </View>
  );
}

/**
 * A seat's own disconnect countdown, for the whole grace (docs/GAME-RULES.md § Decisions). Ticks
 * locally off the server's own `seconds`, restarted by `resetKey` the same way `TurnChip` is.
 */
export function ReconnectingMark({ seconds, resetKey, scale }: { seconds: number; resetKey: string; scale: number }) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(seconds);

  // A new grace window puts the countdown back to full in the same render, so
  // its first frame is never the previous one's remainder.
  const graceWindow = `${resetKey}|${seconds}`;
  const [shownWindow, setShownWindow] = useState(graceWindow);
  if (graceWindow !== shownWindow) {
    setShownWindow(graceWindow);
    setLeft(seconds);
  }

  useEffect(() => {
    let remaining = seconds;
    const id = setInterval(() => {
      remaining -= 1;
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [resetKey, seconds]);

  return (
    <TableNotice kind="reconnecting" tone="neutral" scale={scale}>
      <NoticeText testID="seat-reconnect-chip">{t("gameTable.seatReconnecting", { seconds: left })}</NoticeText>
    </TableNotice>
  );
}

export function VacatedMark({ username, scale }: { username: string; scale: number }) {
  const { t } = useTranslation();
  return (
    <TableNotice kind="vacated" tone="neutral" scale={scale}>
      <NoticeText testID="seat-vacated-chip">{t("game.seatLeft", { username })}</NoticeText>
    </TableNotice>
  );
}

const styles = StyleSheet.create({
  slot: { position: "absolute", alignItems: "center" },
});
