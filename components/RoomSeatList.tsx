import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Avatar } from "@/components/Avatar";
import { teamForSeat } from "@/lib/gameEngine";
import { Colors, Spacing, Radius, FontSize } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";

const TEAM_STRIPE = 3;
const TEAM_COLORS = { A: Colors.gold, B: Colors.info };

const SEAT_ROW_H = 44;
const SEAT_ROW_H_COMPACT = 36;
const SEAT_ROW_PAD_V = 8;
const SEAT_ROW_PAD_V_COMPACT = 4;
const SEAT_LIST_GAP = 6;
const SEAT_LIST_GAP_COMPACT = 4;

/**
 * A hold lapses *before* the timer that drops it fires, never on the same
 * millisecond: an equal comparison would leave the seat held and disarm the
 * only thing that was going to look again.
 */
const HOLD_LAPSE_MARGIN_MS = 1;

export interface SeatHoldView {
  seatIndex: number;
  username: string;
  /** As the server measured it when it sent the room, not a wall-clock time. */
  expiresInMs: number;
}

interface Hold {
  seatIndex: number;
  username: string;
  expiresAt: number;
}

export interface RoomSeatListProps {
  maxSeats: number;
  gameMode: string;
  players: { seatIndex: number; userId: string; username: string }[];
  hostUserId: string | null;
  myUserId?: string;
  seatHolds?: SeatHoldView[];
  isLandscape: boolean;
}

/**
 * The room's seats: who is in them, which side they are on, and which of the
 * empty ones are being held for a friend who has been invited.
 *
 * The hold is dropped on this side as well as the server's. The server refuses
 * the seat the moment the invite ages out, and a lobby still promising it to a
 * name is the room contradicting itself.
 */
export function RoomSeatList({
  maxSeats,
  gameMode,
  players,
  hostUserId,
  myUserId,
  seatHolds,
  isLandscape,
}: RoomSeatListProps) {
  const { t } = useTranslation();
  const [holds, setHolds] = useState<Hold[]>([]);

  useEffect(() => {
    const arrived = Date.now();
    setHolds(
      (seatHolds ?? []).map((hold) => ({
        seatIndex: hold.seatIndex,
        username: hold.username,
        expiresAt: arrived + hold.expiresInMs,
      }))
    );
  }, [seatHolds]);

  useEffect(() => {
    let soonest: number | undefined;
    for (const hold of holds) {
      if (soonest === undefined || hold.expiresAt < soonest) soonest = hold.expiresAt;
    }
    if (soonest === undefined) return;
    const timer = setTimeout(
      () =>
        setHolds((prev) => {
          const live = prev.filter((hold) => hold.expiresAt > Date.now());
          return live.length === prev.length ? prev : live;
        }),
      Math.max(0, soonest - Date.now()) + HOLD_LAPSE_MARGIN_MS
    );
    return () => clearTimeout(timer);
  }, [holds]);

  const rowHeight = isLandscape ? SEAT_ROW_H_COMPACT : SEAT_ROW_H;
  const rowPaddingVertical = isLandscape ? SEAT_ROW_PAD_V_COMPACT : SEAT_ROW_PAD_V;
  const gap = isLandscape ? Spacing.sm : Spacing.cosy;

  return (
    <View style={{ gap: isLandscape ? SEAT_LIST_GAP_COMPACT : SEAT_LIST_GAP }}>
      {Array.from({ length: maxSeats }, (_, seatIndex) => {
        const player = players.find((p) => p.seatIndex === seatIndex);
        // The engine's own rule rather than a copy of it: a teams room of
        // anything but four seats has no 2-v-2 to split into.
        const team = teamForSeat(seatIndex, maxSeats, gameMode as "teams" | "free_for_all");
        const heldFor = player
          ? undefined
          : holds.find((hold) => hold.seatIndex === seatIndex)?.username;
        return (
          <View
            key={seatIndex}
            style={[
              styles.seatRow,
              { height: rowHeight, paddingVertical: rowPaddingVertical },
              team ? { borderLeftColor: TEAM_COLORS[team], borderLeftWidth: TEAM_STRIPE } : undefined,
            ]}
          >
            <Avatar name={player?.username} size={isLandscape ? "sm" : "md"} />
            {player ? (
              <>
                <View style={[styles.slotInfo, { marginLeft: gap }]}>
                  <Text style={styles.slotName} numberOfLines={1}>
                    {player.username}
                    {player.userId === myUserId ? t("room.youSuffix") : ""}
                  </Text>
                  {hostUserId === player.userId && (
                    <Text style={[styles.hostBadge, isLandscape && styles.hostBadgeCompact]}>
                      {t("room.hostBadge")}
                    </Text>
                  )}
                </View>
                {team && (
                  <Text style={[styles.teamBadge, { color: TEAM_COLORS[team] }]}>{team}</Text>
                )}
              </>
            ) : (
              <Text
                style={[heldFor ? styles.slotHeld : styles.slotWaiting, { marginLeft: gap }]}
                numberOfLines={1}
              >
                {heldFor ? t("room.seatHeldFor", { username: heldFor }) : t("room.waitingSeat")}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  seatRow: {
    paddingHorizontal: Spacing.cosy,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.sm,
    flexDirection: "row",
    alignItems: "center",
  },
  slotInfo: { flex: 1, gap: Spacing.xxs },
  slotName: { fontFamily: "Inter_500Medium", fontSize: FontSize.sm, color: Colors.text },
  hostBadge: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.gold,
    letterSpacing: 0.5,
  },
  hostBadgeCompact: {
    fontSize: FontSize.xxs,
  },
  slotWaiting: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  slotHeld: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
  teamBadge: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.sm, letterSpacing: 1 },
});
