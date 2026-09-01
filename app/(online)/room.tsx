import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Share,
  FlatList,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import { hapticMedium, hapticSelection, hapticSuccess } from "@/lib/haptics";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Avatar } from "@/components/Avatar";
import * as Clipboard from "expo-clipboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import {
  useOnlineConnection,
  useOnlineRoom,
  useOnlineTable,
} from "@/context/onlineGameHooks";
import { useNotification } from "@/context/NotificationContext";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { Colors, Spacing, Radius, FontSize, Motion, TOUCH_TARGET_MIN, Type } from '@/lib/theme';
import { firstTargetFor, teamForSeat, TEAMS_PLAYER_COUNT } from "@/lib/gameEngine";
import type { MatchLength } from "@/lib/gameEngine";
import { BOT_PERSONALITIES, DEFAULT_BOT_PERSONALITY, botBlurbKey } from "@/lib/botPersonalities";
import type { BotPersonalityId } from "@/lib/botPersonalities";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuButton } from "@/components/MenuButton";
import { Toggle } from "@/components/Toggle";
import { RoomKindNote } from "@/components/RoomKindNote";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { useTranslation } from "@/lib/i18n";
import { A11yStatus, a11yHidden, a11yState } from "@/lib/a11y";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import type { FriendInfo } from "@/lib/wire";

const CODE_ICON = 15;
const MODE_ICON = 13;
const TEAM_STRIPE = 3;
const TEAM_COLORS = { A: Colors.gold, B: Colors.info };

/** Long enough to read as a confirmation rather than as a flicker. */
const COPIED_FOR_MS = Motion.duration.dwell;

function BotFillControls({
  fillWithBots,
  onToggleFillWithBots,
  botPersonality,
  onChangeBotPersonality,
}: {
  fillWithBots: boolean;
  onToggleFillWithBots: (value: boolean) => void;
  botPersonality: BotPersonalityId;
  onChangeBotPersonality: (id: BotPersonalityId) => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={botFillStyles.section}>
      <View style={botFillStyles.row}>
        <View style={botFillStyles.rowText}>
          <Text style={botFillStyles.label}>{t("room.fillWithBotsLabel")}</Text>
          <Text style={botFillStyles.sublabel}>{t("room.fillWithBotsSubtitle")}</Text>
        </View>
        <Toggle
          value={fillWithBots}
          onValueChange={(value) => {
            onToggleFillWithBots(value);
            hapticSelection();
          }}
          a11yLabel={t("room.fillWithBotsA11yLabel")}
          a11yHint={t("room.fillWithBotsA11yHint")}
        />
      </View>

      {fillWithBots && (
        <View style={botFillStyles.personalityRow}>
          {BOT_PERSONALITIES.map((p) => {
            const selected = botPersonality === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => {
                  onChangeBotPersonality(p.id);
                  hapticSelection();
                }}
                accessibilityLabel={t("room.botPersonalityOptionA11yLabel", {
                  name: p.name,
                  style: t(botBlurbKey(p.id)),
                })}
                {...a11yState({ role: "button", selected })}
                style={[botFillStyles.personalityPill, selected && botFillStyles.personalityPillActive]}
              >
                <Text
                  {...a11yHidden()}
                  style={[
                    botFillStyles.personalityPillText,
                    selected && botFillStyles.personalityPillTextActive,
                  ]}
                >
                  {p.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {fillWithBots && (
        <Text style={botFillStyles.sublabel}>{t(botBlurbKey(botPersonality))}</Text>
      )}
    </View>
  );
}

/** Host-only: how long the game runs. Mirrors the offline lobby's picker. */
function MatchLengthControls({
  value,
  onChange,
  seats,
}: {
  value: MatchLength;
  onChange: (length: MatchLength) => void;
  seats: number;
}) {
  const { t } = useTranslation();
  const copy = (length: MatchLength) =>
    length === "match"
      ? { title: t("lobby.formatMatch"), detail: t("lobby.formatMatchSub", { target: firstTargetFor(seats) }) }
      : { title: t("lobby.formatSingle"), detail: t("lobby.formatSingleSub") };

  return (
    <View style={formatStyles.section}>
      <Text style={formatStyles.label}>{t("room.formatLabel")}</Text>
      <View style={formatStyles.row}>
        {(["match", "single"] as MatchLength[]).map((length) => {
          const selected = value === length;
          const { title, detail } = copy(length);
          return (
            <Pressable
              key={length}
              onPress={() => {
                onChange(length);
                hapticSelection();
              }}
              style={[formatStyles.option, selected && formatStyles.optionActive]}
              accessibilityLabel={t("lobby.formatA11yLabel", { format: title, detail })}
              {...a11yState({ role: "radio", selected })}
            >
              <Text {...a11yHidden()} style={[formatStyles.optionTitle, selected && formatStyles.optionTitleActive]}>
                {title}
              </Text>
              <Text {...a11yHidden()} style={[formatStyles.optionDetail, selected && formatStyles.optionDetailActive]}>
                {detail}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const formatStyles = StyleSheet.create({
  section: { gap: Spacing.sm },
  label: {
    fontFamily: "Inter_600SemiBold",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  row: { flexDirection: "row", gap: Spacing.sm },
  option: {
    flex: 1,
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs / 2,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  optionActive: { borderColor: Colors.gold, backgroundColor: Colors.goldMuted },
  optionTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  optionTitleActive: { color: Colors.gold },
  optionDetail: {
    ...Type.caption,
    textAlign: "center",
  },
  optionDetailActive: { color: Colors.goldLight },
});


function InviteFriendsPanel({
  roomCode,
  playerUserIds,
  myUserId,
  isLandscape,
}: {
  roomCode: string;
  playerUserIds: string[];
  myUserId: string;
  isLandscape: boolean;
}) {
  const { t } = useTranslation();
  const { onlineIds, socket } = useSocket();
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (socket) socket.emit("friend:get_online_list");
  }, [socket]);

  const { data: friends = [] } = useQuery<FriendInfo[]>({
    queryKey: ["/api/friends"],
  });

  const onlineFriendsNotInRoom = friends.filter(
    (f) => onlineIds.has(f.id) && !playerUserIds.includes(f.id)
  );

  function handleInvite(friend: FriendInfo) {
    socket?.emit("friend:invite", { friendUserId: friend.id, roomCode });
    setSentIds((prev) => new Set(prev).add(friend.id));
    setTimeout(() => {
      setSentIds((prev) => {
        const next = new Set(prev);
        next.delete(friend.id);
        return next;
      });
    }, 2000);
  }

  // The list does not scroll, so its height is exactly the rows it shows: landscape keeps
  // the row at the touch floor by showing one fewer, never by making the row shorter.
  const ROW_H = TOUCH_TARGET_MIN;
  const maxVisible = isLandscape ? 2 : 3;
  const listMaxHeight = ROW_H * maxVisible + 12;

  return (
    <View style={{ flex: 1, minHeight: isLandscape ? 80 : 110 }}>
      <Text style={[styles.slotsSectionTitle, { color: Colors.gold, marginBottom: isLandscape ? 4 : 6 }]}>
        {t("room.inviteFriendsTitle")}
      </Text>
      {onlineFriendsNotInRoom.length === 0 ? (
        <View style={[inviteStyles.emptyContainer, { backgroundColor: Colors.bgCard, borderRadius: Radius.sm }]}>
          <Text style={inviteStyles.emptyText}>{t("room.noFriendsOnline")}</Text>
        </View>
      ) : (
        <FlatList
          data={onlineFriendsNotInRoom.slice(0, maxVisible)}
          keyExtractor={(f) => f.id}
          // The data is already capped at maxVisible and the list is tall
          // enough for it; scrolling here would only nest inside the portrait
          // ScrollView.
          scrollEnabled={false}
          style={{
            maxHeight: listMaxHeight,
            borderRadius: Radius.sm,
            backgroundColor: Colors.bgCard,
          }}
          showsVerticalScrollIndicator={true}
          renderItem={({ item: friend }) => {
            const sent = sentIds.has(friend.id);
            return (
              <Pressable
                onPress={() => handleInvite(friend)}
                disabled={sent}
                style={({ pressed }) => [
                  inviteStyles.row,
                  { height: ROW_H },
                  pressed && { opacity: 0.8 },
                ]}
                accessibilityLabel={sent ? t("room.inviteSentA11yLabel", { username: friend.username }) : t("room.inviteA11yLabel", { username: friend.username })}
                {...a11yState({ role: "button", disabled: sent })}
              >
                <Avatar name={friend.username} size="sm" online />
                <Text style={inviteStyles.friendName} numberOfLines={1} {...a11yHidden()}>
                  {friend.username}
                </Text>
                {sent ? (
                  <Ionicons name="checkmark-circle" size={16} color={Colors.success} {...a11yHidden()} />
                ) : (
                  <View style={inviteStyles.inviteBtn} {...a11yHidden()}>
                    <Text style={inviteStyles.inviteBtnText}>{t("room.invite")}</Text>
                  </View>
                )}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={inviteStyles.emptyText}>{t("room.noFriendsOnline")}</Text>
          }
        />
      )}
    </View>
  );
}

export default function RoomScreen() {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const entering = reduceMotion ? undefined : FadeIn.duration(Motion.duration.travel);
  const { width: W, height: H } = useWindowDimensions();
  const { user } = useAuth();
  const { room, leaveRoom, startGame, entrySource } = useOnlineRoom();
  const { gameState } = useOnlineTable();
  const { error, clearError } = useOnlineConnection();
  const { showNotification } = useNotification();

  const [fillWithBots, setFillWithBots] = useState(false);
  const [botPersonality, setBotPersonality] = useState<BotPersonalityId>(DEFAULT_BOT_PERSONALITY);
  const [matchLength, setMatchLength] = useState<MatchLength>("match");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const isLandscape = W > H;

  const playerItemHeight = isLandscape ? 36 : 44;
  const playerItemPaddingVertical = isLandscape ? 4 : 8;
  const playerListGap = isLandscape ? 4 : 6;

  const hasGameState = !!gameState;
  useEffect(() => {
    if (hasGameState) {
      router.replace("/(online)/game");
    }
  }, [hasGameState]);

  useEffect(() => {
    if (!room) {
      if (entrySource === "quickmatch") {
        router.replace("/(online)/quickmatch");
      } else {
        router.replace("/(online)");
      }
    }
  }, [room, entrySource]);

  useEffect(() => {
    if (error) {
      showNotification({ type: "game_error", title: t("common.error"), message: error });
      clearError();
    }
  }, [error, clearError, showNotification, t]);

  if (!room) return null;

  const isHost = room.hostUserId === user?.id;
  const maxSeats = room.maxPlayers;
  const hasEmptySeats = room.players.length < maxSeats;
  const showInvitePanel = room.status === "waiting" && hasEmptySeats && !!user;
  // Bots fill every empty seat, so a single host is enough to start —
  // otherwise at least 2 seated humans are required.
  const notEnoughPlayers = !fillWithBots && room.players.length < 2;
  const seatsAtStart = fillWithBots ? maxSeats : room.players.length;
  const teamsNeedFour =
    room.gameMode === "teams" && seatsAtStart !== TEAMS_PLAYER_COUNT;
  const canStart =
    isHost && !notEnoughPlayers && !teamsNeedFour && room.status === "waiting";
  const showBotFillControls = isHost && room.status === "waiting" && hasEmptySeats;

  // The button's face is the only feedback there is: nothing else on the
  // screen changes when the code reaches the clipboard, and the haptic below
  // is silent on web. Its accessible name deliberately does not follow —
  // renaming a live control to a past-tense status makes it unreachable by
  // name for as long as it says it, and no screen reader re-announces a name
  // that changes under a control it has already activated. The confirmation
  // reaches them as a live region instead.
  const copyFace = t(copied ? "common.copied" : "common.copy");

  async function handleCopyCode() {
    await Clipboard.setStringAsync(room!.code);
    hapticSuccess();
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
  }

  async function handleShare() {
    await Share.share({ message: t("room.shareMessage", { code: room!.code }) });
  }

  function handleLeave() {
    setConfirming({
      title: t("room.leaveConfirmTitle"),
      body: t("room.leaveConfirmBody"),
      cancelLabel: t("common.cancel"),
      confirmLabel: t("room.leaveConfirmConfirm"),
      destructive: true,
      onConfirm: () => {
        leaveRoom();
        if (entrySource === "quickmatch") {
          router.replace("/(online)/quickmatch");
        } else {
          router.replace("/(online)");
        }
      },
    });
  }

  function handleStart() {
    if (!canStart) return;
    hapticMedium();
    startGame({ fillWithBots, botPersonality, matchLength });
  }

  const modeLabel = room.gameMode === "teams" ? t("room.modeTeams") : t("room.modeFreeForAll");
  const modeIcon: "people" | "person" = room.gameMode === "teams" ? "people" : "person";

  const playerUserIds = room.players.map((p) => p.userId);

  const formatControls = isHost && room.status === "waiting" ? (
    <MatchLengthControls value={matchLength} onChange={setMatchLength} seats={maxSeats} />
  ) : null;

  const botFillControls = showBotFillControls ? (
    <BotFillControls
      fillWithBots={fillWithBots}
      onToggleFillWithBots={setFillWithBots}
      botPersonality={botPersonality}
      onChangeBotPersonality={setBotPersonality}
    />
  ) : null;

  const StartButton = isHost ? (
    <MenuButton
      label={
        teamsNeedFour
          ? t("room.teamsNeedFour")
          : notEnoughPlayers
            ? t("room.waitingForPlayers")
            : t("room.startGame")
      }
      onPress={handleStart}
      disabled={!canStart}
      icon={<Ionicons name="play-circle" size={22} color={canStart ? Colors.bgCard : Colors.textMuted} />}
    />
  ) : (
    <View style={styles.waitingHost}>
      <Ionicons name="time-outline" size={18} color={Colors.textMuted} />
      <Text style={styles.waitingText}>{t("room.waitingForHost")}</Text>
    </View>
  );

  // Built once and placed by each orientation, rather than written out in
  // both: the two branches differ in where these sit and how tightly they are
  // packed, never in what they are.
  const codeCard = (
    <Animated.View
      entering={entering}
      style={isLandscape ? styles.codeSectionCompact : styles.codeSection}
    >
      <Text style={styles.codeLabel}>{t("room.codeLabel")}</Text>
      <Text style={isLandscape ? styles.codeTextCompact : styles.codeText}>{room.code}</Text>
      <View style={styles.codeActions}>
        <Pressable
          onPress={handleCopyCode}
          style={styles.codeBtn}
          accessibilityRole="button"
          accessibilityLabel={t("common.copy")}
          hitSlop={Spacing.sm}
        >
          <Ionicons name="copy-outline" size={CODE_ICON} color={Colors.gold} {...a11yHidden()} />
          <Text style={styles.codeBtnText} {...a11yHidden()}>{copyFace}</Text>
        </Pressable>
        <A11yStatus label={copied ? t("common.copied") : ""} />
        <Pressable
          onPress={handleShare}
          style={styles.codeBtn}
          accessibilityRole="button"
          accessibilityLabel={t("room.share")}
          hitSlop={Spacing.sm}
        >
          <Ionicons name="share-outline" size={CODE_ICON} color={Colors.gold} {...a11yHidden()} />
          <Text style={styles.codeBtnText} {...a11yHidden()}>{t("room.share")}</Text>
        </Pressable>
      </View>
      <RoomKindNote visibility={room.visibility} />
    </Animated.View>
  );

  const modePill = (
    <View style={styles.modePill}>
      <Ionicons name={modeIcon} size={MODE_ICON} color={Colors.textMuted} />
      <Text style={styles.modePillText}>
        {t("room.modeAndPlayers", { mode: modeLabel, n: room.maxPlayers })}
      </Text>
    </View>
  );

  const seatList = (
    <View style={{ gap: playerListGap }}>
      {Array.from({ length: maxSeats }, (_, i) => {
        const player = room.players.find((p) => p.seatIndex === i);
        // The engine's own rule rather than a copy of it: a teams room of
        // anything but four seats has no 2-v-2 to split into.
        const team = teamForSeat(i, maxSeats, room.gameMode);
        const gap = isLandscape ? Spacing.sm : Spacing.cosy;
        return (
          <View
            key={i}
            style={[
              styles.seatRow,
              { height: playerItemHeight, paddingVertical: playerItemPaddingVertical },
              team ? { borderLeftColor: TEAM_COLORS[team], borderLeftWidth: TEAM_STRIPE } : undefined,
            ]}
          >
            <Avatar name={player?.username} size={isLandscape ? "sm" : "md"} />
            {player ? (
              <>
                <View style={[styles.slotInfo, { marginLeft: gap }]}>
                  <Text style={styles.slotName} numberOfLines={1}>
                    {player.username}
                    {player.userId === user?.id ? t("room.youSuffix") : ""}
                  </Text>
                  {room.hostUserId === player.userId && (
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
              <Text style={[styles.slotWaiting, { marginLeft: gap }]}>
                {t("room.waitingSeat")}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );

  if (isLandscape) {
    return (
      <MenuLayout scrollable={false} centered={false} maxWidth={null} style={{ paddingBottom: 0 }}>
        <ScreenHeader
          title={t("room.title")}
          onBack={handleLeave}
          backLabel={t("room.leaveA11yLabel")}
        />

        <View style={styles.landscapeBody}>
          {/* LEFT: code card, mode pill, start button */}
          <View style={styles.landscapeLeft}>
            {/* Scrolls rather than overflows: at phone-landscape heights the
                code card, mode pill, format picker and bot controls together
                exceed the column, and without this they ran underneath the
                start button instead of being reachable. */}
            <ScrollView
              style={styles.landscapeLeftScroll}
              contentContainerStyle={styles.landscapeLeftScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {codeCard}

              {modePill}

              {formatControls}
              {botFillControls}
            </ScrollView>

            <View style={styles.landscapeFooter}>
              {StartButton}
            </View>
          </View>

          <View style={styles.landscapeDivider} />

          {/* RIGHT: giocatori + invita amici */}
          <View style={styles.landscapeRight}>
            <View style={{ gap: Spacing.xs, marginBottom: Spacing.sm }}>
              <Text style={[styles.slotsSectionTitle, { marginBottom: Spacing.xxs }]}>
                {t("room.playersCount", { current: room.players.length, max: maxSeats })}
              </Text>
              {seatList}
            </View>

            {showInvitePanel && (
              <InviteFriendsPanel
                roomCode={room.code}
                playerUserIds={playerUserIds}
                myUserId={user!.id}
                isLandscape={isLandscape}
              />
            )}
          </View>
        </View>

        <ConfirmDialog request={confirming} onClose={() => setConfirming(null)} />
      </MenuLayout>
    );
  }

  return (
    <MenuLayout scrollable={false} centered={false} style={{ paddingBottom: 0 }}>
      <ScreenHeader
        title={t("room.title")}
        onBack={handleLeave}
        backLabel={t("room.leaveA11yLabel")}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: Spacing.roomy, paddingTop: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.cosy }}
        showsVerticalScrollIndicator={false}
      >
        {codeCard}

        {modePill}

        {formatControls}
        {botFillControls}

        <View style={{ gap: Spacing.slim }}>
          <Text style={[styles.slotsSectionTitle, { marginBottom: Spacing.xxs }]}>
            {t("room.playersCount", { current: room.players.length, max: maxSeats })}
          </Text>
          {seatList}
        </View>

        {showInvitePanel && (
          <InviteFriendsPanel
            roomCode={room.code}
            playerUserIds={playerUserIds}
            myUserId={user!.id}
            isLandscape={isLandscape}
          />
        )}
      </ScrollView>

      <View style={styles.footer}>{StartButton}</View>

      <ConfirmDialog request={confirming} onClose={() => setConfirming(null)} />
    </MenuLayout>
  );
}

const botFillStyles = StyleSheet.create({
  section: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: TOUCH_TARGET_MIN,
    gap: Spacing.sm,
  },
  rowText: { flex: 1, gap: Spacing.xxs },
  label: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.md,
    color: Colors.text,
  },
  sublabel: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  personalityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  personalityPill: {
    // Five names never fit one phone-width row; wrap to two rather than clip.
    flexGrow: 1,
    flexBasis: "28%",
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.sm,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  personalityPillActive: {
    borderColor: Colors.gold,
    backgroundColor: Colors.goldMuted,
  },
  personalityPillText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  personalityPillTextActive: {
    color: Colors.gold,
  },
});

const inviteStyles = StyleSheet.create({
  emptyContainer: {
    paddingHorizontal: Spacing.cosy,
    paddingVertical: Spacing.snug,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.snug,
    paddingHorizontal: Spacing.cosy,
  },
  friendName: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.sm,
    color: Colors.text,
    flex: 1,
  },
  inviteBtn: {
    backgroundColor: Colors.goldMuted,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
  },
  inviteBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: FontSize.xs,
    color: Colors.gold,
  },
});

const styles = StyleSheet.create({

  seatRow: {
    paddingHorizontal: Spacing.cosy,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.sm,
    flexDirection: "row",
    alignItems: "center",
  },
  landscapeBody: {
    flex: 1,
    flexDirection: "row",
    paddingTop: Spacing.sm,
    gap: 0,
  },
  landscapeLeft: {
    width: 240,
    flexDirection: "column",
    paddingLeft: Spacing.cosy,
    paddingRight: Spacing.cosy,
  },
  landscapeLeftScroll: { flex: 1 },
  landscapeLeftScrollContent: { gap: Spacing.sm },
  landscapeDivider: {
    width: 1,
    backgroundColor: Colors.border,
    marginRight: Spacing.cosy,
  },
  landscapeRight: {
    flex: 1,
    paddingRight: Spacing.sm,
    paddingTop: Spacing.xs,
    gap: 0,
  },
  landscapeFooter: {
    gap: Spacing.slim,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },

  codeSection: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    paddingVertical: Spacing.cosy,
    paddingHorizontal: Spacing.roomy,
    alignItems: "center",
    gap: Spacing.sm,
  },
  codeSectionCompact: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.cosy,
    alignItems: "center",
    gap: Spacing.xs,
  },
  codeLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  codeText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.hero,
    color: Colors.gold,
    letterSpacing: 10,
  },
  codeTextCompact: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xl,
    color: Colors.gold,
    letterSpacing: 6,
  },
  codeActions: { flexDirection: "row", gap: Spacing.roomy, marginTop: Spacing.xxs },
  codeBtn: { flexDirection: "row", alignItems: "center", gap: Spacing.slim, padding: Spacing.xs, minHeight: TOUCH_TARGET_MIN },
  codeBtnText: { fontFamily: "Inter_500Medium", fontSize: FontSize.sm, color: Colors.gold },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: Spacing.slim,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.snug,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modePillText: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },

  slotsSectionTitle: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    letterSpacing: 2,
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
  slotWaiting: { flex: 1, fontFamily: "Inter_400Regular", fontSize: FontSize.sm, color: Colors.textMuted },
  teamBadge: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.sm, letterSpacing: 1 },
  footer: { paddingHorizontal: Spacing.roomy, paddingTop: Spacing.sm, paddingBottom: Spacing.xs, gap: Spacing.xs },
  waitingHost: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.snug,
    paddingVertical: Spacing.snug,
  },
  waitingText: { fontFamily: "Inter_400Regular", fontSize: FontSize.sm, color: Colors.textMuted },
});
