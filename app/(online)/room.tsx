import React, { useState, useEffect } from "react";
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
import * as Clipboard from "expo-clipboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { useOnlineGame } from "@/context/OnlineGameContext";
import { useNotification } from "@/context/NotificationContext";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { Colors, Spacing, Radius, FontSize, Motion, TOUCH_TARGET_MIN, Type } from '@/lib/theme';
import { targetsFor, TEAMS_PLAYER_COUNT } from "@/lib/gameEngine";
import type { MatchLength } from "@/lib/gameEngine";
import { BOT_PERSONALITIES, DEFAULT_BOT_PERSONALITY, botBlurbKey } from "@/lib/botPersonalities";
import type { BotPersonalityId } from "@/lib/botPersonalities";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuButton } from "@/components/MenuButton";
import { Toggle } from "@/components/Toggle";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { useTranslation } from "@/lib/i18n";
import { a11yState } from "@/lib/a11y";
import { usePrefersReducedMotion } from "@/lib/accessibility";

const TEAM_COLORS = { A: Colors.gold, B: Colors.info };

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
      ? { title: t("lobby.formatMatch"), detail: t("lobby.formatMatchSub", { target: targetsFor(seats)[0] }) }
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
              <Text style={[formatStyles.optionTitle, selected && formatStyles.optionTitleActive]}>
                {title}
              </Text>
              <Text style={[formatStyles.optionDetail, selected && formatStyles.optionDetailActive]}>
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
    minHeight: 44,
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

interface FriendInfo {
  id: string;
  username: string;
  lastSeen: string | null;
}

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

  const ROW_H = isLandscape ? 36 : 44;
  const maxVisible = 3;
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
                <View style={inviteStyles.avatar}>
                  <Text style={inviteStyles.avatarInitial}>
                    {friend.username.charAt(0).toUpperCase()}
                  </Text>
                  <View style={inviteStyles.onlineDot} />
                </View>
                <Text style={inviteStyles.friendName} numberOfLines={1}>
                  {friend.username}
                </Text>
                {sent ? (
                  <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                ) : (
                  <View style={inviteStyles.inviteBtn}>
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
  const entering = reduceMotion ? undefined : FadeIn.duration(Motion.duration.moderate);
  const { width: W, height: H } = useWindowDimensions();
  const { user } = useAuth();
  const {
    room,
    gameState,
    error,
    clearError,
    leaveRoom,
    startGame,
    entrySource,
  } = useOnlineGame();
  const { showNotification } = useNotification();

  const [fillWithBots, setFillWithBots] = useState(false);
  const [botPersonality, setBotPersonality] = useState<BotPersonalityId>(DEFAULT_BOT_PERSONALITY);
  const [matchLength, setMatchLength] = useState<MatchLength>("match");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);

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

  async function handleCopyCode() {
    await Clipboard.setStringAsync(room!.code);
    hapticSuccess();
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

  if (isLandscape) {
    return (
      <MenuLayout scrollable={false} centered={false} maxWidth={null} style={{ paddingBottom: 0 }}>
        <View style={styles.topBar}>
          <Pressable
            onPress={handleLeave}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={t("room.leaveA11yLabel")}
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={22} color={Colors.gold} />
          </Pressable>
          <Text style={styles.screenTitle}>{t("room.title")}</Text>
          <View style={{ width: 38 }} />
        </View>

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
              <Animated.View entering={entering} style={styles.codeSectionCompact}>
                <Text style={styles.codeLabel}>{t("room.codeLabel")}</Text>
                <Text style={styles.codeTextCompact}>{room.code}</Text>
                <View style={styles.codeActions}>
                  <Pressable
                    onPress={handleCopyCode}
                    style={styles.codeBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.copy")}
                    hitSlop={8}
                  >
                    <Ionicons name="copy-outline" size={15} color={Colors.gold} />
                    <Text style={styles.codeBtnText}>{t("common.copy")}</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleShare}
                    style={styles.codeBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t("room.share")}
                    hitSlop={8}
                  >
                    <Ionicons name="share-outline" size={15} color={Colors.gold} />
                    <Text style={styles.codeBtnText}>{t("room.share")}</Text>
                  </Pressable>
                </View>
              </Animated.View>

              <View style={styles.modePill}>
                <Ionicons name={modeIcon} size={13} color={Colors.textMuted} />
                <Text style={styles.modePillText}>
                  {t("room.modeAndPlayers", { mode: modeLabel, n: room.maxPlayers })}
                </Text>
              </View>

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
              <View style={{ gap: playerListGap }}>
                {Array.from({ length: maxSeats }, (_, i) => {
                  const player = room.players.find((p) => p.seatIndex === i);
                  const team = room.gameMode === "teams" ? (i % 2 === 0 ? "A" : "B") : null;
                  return (
                    <View
                      key={i}
                      style={[
                        {
                          height: playerItemHeight,
                          paddingVertical: playerItemPaddingVertical,
                          paddingHorizontal: Spacing.cosy,
                          backgroundColor: Colors.bgCard,
                          borderRadius: Radius.sm,
                          flexDirection: "row",
                          alignItems: "center",
                        },
                        team ? { borderLeftColor: TEAM_COLORS[team as "A" | "B"], borderLeftWidth: 3 } : undefined,
                      ]}
                    >
                      {player ? (
                        <>
                          <View style={[styles.slotAvatar, styles.slotAvatarCompact]}>
                            <Text style={[styles.slotInitial, styles.slotInitialCompact]}>
                              {player.username.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={[styles.slotInfo, { marginLeft: Spacing.sm }]}>
                            <Text style={styles.slotName} numberOfLines={1}>
                              {player.username}
                              {player.userId === user?.id ? t("room.youSuffix") : ""}
                            </Text>
                            {room.hostUserId === player.userId && (
                              <Text style={[styles.hostBadge, styles.hostBadgeCompact]}>{t("room.hostBadge")}</Text>
                            )}
                          </View>
                          {team && (
                            <Text style={[styles.teamBadge, { color: TEAM_COLORS[team as "A" | "B"] }]}>
                              {team}
                            </Text>
                          )}
                        </>
                      ) : (
                        <>
                          <View style={[styles.slotAvatar, styles.slotAvatarEmpty, styles.slotAvatarCompact]}>
                            <Ionicons name="person-add-outline" size={14} color={Colors.textMuted} />
                          </View>
                          <Text style={[styles.slotWaiting, { marginLeft: Spacing.sm }]}>{t("room.waitingSeat")}</Text>
                        </>
                      )}
                    </View>
                  );
                })}
              </View>
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
      <View style={styles.topBar}>
        <Pressable
          onPress={handleLeave}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t("room.leaveA11yLabel")}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={Colors.gold} />
        </Pressable>
        <Text style={styles.screenTitle}>{t("room.title")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: Spacing.roomy, paddingTop: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.cosy }}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={entering} style={styles.codeSection}>
          <Text style={styles.codeLabel}>{t("room.codeLabel")}</Text>
          <Text style={styles.codeText}>{room.code}</Text>
          <View style={styles.codeActions}>
            <Pressable
              onPress={handleCopyCode}
              style={styles.codeBtn}
              accessibilityRole="button"
              accessibilityLabel={t("common.copy")}
              hitSlop={Spacing.sm}
            >
              <Ionicons name="copy-outline" size={16} color={Colors.gold} />
              <Text style={styles.codeBtnText}>{t("common.copy")}</Text>
            </Pressable>
            <Pressable
              onPress={handleShare}
              style={styles.codeBtn}
              accessibilityRole="button"
              accessibilityLabel={t("room.share")}
              hitSlop={Spacing.sm}
            >
              <Ionicons name="share-outline" size={16} color={Colors.gold} />
              <Text style={styles.codeBtnText}>{t("room.share")}</Text>
            </Pressable>
          </View>
        </Animated.View>

        <View style={styles.modePill}>
          <Ionicons name={modeIcon} size={13} color={Colors.textMuted} />
          <Text style={styles.modePillText}>
            {t("room.modeAndPlayers", { mode: modeLabel, n: room.maxPlayers })}
          </Text>
        </View>

        {formatControls}
        {botFillControls}

        <View style={{ gap: Spacing.slim }}>
          <Text style={[styles.slotsSectionTitle, { marginBottom: Spacing.xxs }]}>
            {t("room.playersCount", { current: room.players.length, max: maxSeats })}
          </Text>
          <View style={{ gap: playerListGap }}>
            {Array.from({ length: maxSeats }, (_, i) => {
              const player = room.players.find((p) => p.seatIndex === i);
              const team = room.gameMode === "teams" ? (i % 2 === 0 ? "A" : "B") : null;
              return (
                <View
                  key={i}
                  style={[
                    {
                      height: playerItemHeight,
                      paddingVertical: playerItemPaddingVertical,
                      paddingHorizontal: Spacing.cosy,
                      backgroundColor: Colors.bgCard,
                      borderRadius: Radius.sm,
                      flexDirection: "row",
                      alignItems: "center",
                    },
                    team ? { borderLeftColor: TEAM_COLORS[team as "A" | "B"], borderLeftWidth: 3 } : undefined,
                  ]}
                >
                  {player ? (
                    <>
                      <View style={styles.slotAvatar}>
                        <Text style={styles.slotInitial}>
                          {player.username.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={[styles.slotInfo, { marginLeft: Spacing.cosy }]}>
                        <Text style={styles.slotName} numberOfLines={1}>
                          {player.username}
                          {player.userId === user?.id ? t("room.youSuffix") : ""}
                        </Text>
                        {room.hostUserId === player.userId && (
                          <Text style={styles.hostBadge}>{t("room.hostBadge")}</Text>
                        )}
                      </View>
                      {team && (
                        <Text style={[styles.teamBadge, { color: TEAM_COLORS[team as "A" | "B"] }]}>
                          {team}
                        </Text>
                      )}
                    </>
                  ) : (
                    <>
                      <View style={[styles.slotAvatar, styles.slotAvatarEmpty]}>
                        <Ionicons name="person-add-outline" size={18} color={Colors.textMuted} />
                      </View>
                      <Text style={[styles.slotWaiting, { marginLeft: Spacing.cosy }]}>{t("room.waitingSeat")}</Text>
                    </>
                  )}
                </View>
              );
            })}
          </View>
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
    minHeight: 44,
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
    minHeight: 44,
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
  avatar: {
    width: 30,
    height: 30,
    borderRadius: Radius.full,
    backgroundColor: Colors.felt,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    flexShrink: 0,
  },
  avatarInitial: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.gold,
  },
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 9,
    height: 9,
    borderRadius: Radius.full,
    backgroundColor: Colors.success,
    borderWidth: 1.5,
    borderColor: Colors.bgSurface,
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    paddingBottom: Spacing.sm,
    marginBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  screenTitle: {
    flex: 1,
    textAlign: "center",
    ...Type.heading,
    fontSize: FontSize.xl,
    letterSpacing: 3,
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
  slotAvatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.felt,
    alignItems: "center",
    justifyContent: "center",
  },
  slotAvatarCompact: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
  },
  slotAvatarEmpty: { backgroundColor: Colors.bgCard },
  slotInitial: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.md, color: Colors.gold },
  slotInitialCompact: { fontSize: FontSize.sm },
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
