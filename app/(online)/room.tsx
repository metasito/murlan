import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Share,
  Alert,
  FlatList,
  Switch,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import { hapticMedium, hapticSelection, hapticSuccess } from "@/lib/haptics";
import * as Clipboard from "expo-clipboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { useOnlineGame } from "@/context/OnlineGameContext";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { getSocket } from "@/lib/socket";
import { Colors, Spacing, Radius, FontSize, Motion, Type } from '@/lib/theme';
import { MATCH_TARGETS } from "@/lib/gameEngine";
import type { MatchLength } from "@/lib/gameEngine";
import { BOT_PERSONALITIES, DEFAULT_BOT_PERSONALITY, botBlurbKey } from "@/lib/botPersonalities";
import type { BotPersonalityId } from "@/lib/botPersonalities";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuButton } from "@/components/MenuButton";
import { useTranslation } from "@/lib/i18n";
import { A11yHintText, a11yHint, a11yState } from "@/lib/a11y";
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
        <Switch
          value={fillWithBots}
          onValueChange={(value) => {
            onToggleFillWithBots(value);
            hapticSelection();
          }}
          trackColor={{ false: Colors.bgElevated, true: Colors.gold }}
          thumbColor={fillWithBots ? Colors.white : Colors.textMuted}
          accessibilityRole="switch"
          accessibilityLabel={t("room.fillWithBotsA11yLabel")}
          {...a11yHint(t("room.fillWithBotsA11yHint"))}
        />
        <A11yHintText hint={t("room.fillWithBotsA11yHint")} />
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
}: {
  value: MatchLength;
  onChange: (length: MatchLength) => void;
}) {
  const { t } = useTranslation();
  const copy = (length: MatchLength) =>
    length === "match"
      ? { title: t("lobby.formatMatch"), detail: t("lobby.formatMatchSub", { target: MATCH_TARGETS[0] }) }
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
    const socket = getSocket(myUserId);
    socket.emit("friend:invite", { friendUserId: friend.id, roomCode });
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
        <View style={[inviteStyles.emptyContainer, { backgroundColor: Colors.bgCard, borderRadius: 10 }]}>
          <Text style={inviteStyles.emptyText}>{t("room.noFriendsOnline")}</Text>
        </View>
      ) : (
        <FlatList
          data={onlineFriendsNotInRoom.slice(0, maxVisible)}
          keyExtractor={(f) => f.id}
          scrollEnabled={true}
          style={{
            maxHeight: listMaxHeight,
            borderRadius: 10,
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

  const [fillWithBots, setFillWithBots] = useState(false);
  const [botPersonality, setBotPersonality] = useState<BotPersonalityId>(DEFAULT_BOT_PERSONALITY);
  const [matchLength, setMatchLength] = useState<MatchLength>("match");

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
      Alert.alert(t("common.error"), error, [{ text: t("common.ok"), onPress: clearError }]);
    }
  }, [error, clearError, t]);

  if (!room) return null;

  const isHost = room.hostUserId === user?.id;
  const maxSeats = room.maxPlayers;
  const hasEmptySeats = room.players.length < maxSeats;
  const showInvitePanel = room.status === "waiting" && hasEmptySeats && !!user;
  // Bots fill every empty seat, so a single host is enough to start —
  // otherwise at least 2 seated humans are required.
  const notEnoughPlayers = !fillWithBots && room.players.length < 2;
  const canStart = isHost && !notEnoughPlayers && room.status === "waiting";
  const showBotFillControls = isHost && room.status === "waiting" && hasEmptySeats;

  async function handleCopyCode() {
    await Clipboard.setStringAsync(room!.code);
    hapticSuccess();
  }

  async function handleShare() {
    await Share.share({ message: t("room.shareMessage", { code: room!.code }) });
  }

  function handleLeave() {
    Alert.alert(
      t("room.leaveConfirmTitle"),
      t("room.leaveConfirmBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("room.leaveConfirmConfirm"),
          style: "destructive",
          onPress: () => {
            leaveRoom();
            if (entrySource === "quickmatch") {
              router.replace("/(online)/quickmatch");
            } else {
              router.replace("/(online)");
            }
          },
        },
      ]
    );
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
    <MatchLengthControls value={matchLength} onChange={setMatchLength} />
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
      label={notEnoughPlayers ? t("room.waitingForPlayers") : t("room.startGame")}
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
            <View style={{ gap: 4, marginBottom: 8 }}>
              <Text style={[styles.slotsSectionTitle, { marginBottom: 2 }]}>
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
                          paddingHorizontal: 12,
                          backgroundColor: Colors.bgCard,
                          borderRadius: 10,
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
                          <View style={[styles.slotInfo, { marginLeft: 8 }]}>
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
                          <Text style={[styles.slotWaiting, { marginLeft: 8 }]}>{t("room.waitingSeat")}</Text>
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

      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 12 }}>
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

        <View style={{ gap: 6 }}>
          <Text style={[styles.slotsSectionTitle, { marginBottom: 2 }]}>
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
                      paddingHorizontal: 12,
                      backgroundColor: Colors.bgCard,
                      borderRadius: 10,
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
                      <View style={[styles.slotInfo, { marginLeft: 12 }]}>
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
                      <Text style={[styles.slotWaiting, { marginLeft: 12 }]}>{t("room.waitingSeat")}</Text>
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

      <View style={styles.footer}>{StartButton}</View>
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
  rowText: { flex: 1, gap: 2 },
  label: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 15,
    color: Colors.text,
  },
  sublabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
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
    fontSize: 13,
    color: Colors.textSecondary,
  },
  personalityPillTextActive: {
    color: Colors.gold,
  },
});

const inviteStyles = StyleSheet.create({
  emptyContainer: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.felt,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    flexShrink: 0,
  },
  avatarInitial: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 14,
    color: Colors.gold,
  },
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: Colors.success,
    borderWidth: 1.5,
    borderColor: Colors.bgSurface,
  },
  friendName: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.text,
    flex: 1,
  },
  inviteBtn: {
    backgroundColor: Colors.goldMuted,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  inviteBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
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
    paddingTop: 8,
    gap: 0,
  },
  landscapeLeft: {
    width: 240,
    flexDirection: "column",
    paddingLeft: 12,
    paddingRight: 12,
  },
  landscapeLeftScroll: { flex: 1 },
  landscapeLeftScrollContent: { gap: Spacing.sm },
  landscapeDivider: {
    width: 1,
    backgroundColor: Colors.border,
    marginRight: 12,
  },
  landscapeRight: {
    flex: 1,
    paddingRight: 8,
    paddingTop: 4,
    gap: 0,
  },
  landscapeFooter: {
    gap: 6,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },

  codeSection: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 8,
  },
  codeSectionCompact: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 4,
  },
  codeLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  codeText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 42,
    color: Colors.gold,
    letterSpacing: 10,
  },
  codeTextCompact: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 26,
    color: Colors.gold,
    letterSpacing: 6,
  },
  codeActions: { flexDirection: "row", gap: 20, marginTop: 2 },
  codeBtn: { flexDirection: "row", alignItems: "center", gap: 6, padding: 4, minHeight: 32 },
  codeBtnText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.gold },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modePillText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
  },

  slotsSectionTitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  slotAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.felt,
    alignItems: "center",
    justifyContent: "center",
  },
  slotAvatarCompact: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  slotAvatarEmpty: { backgroundColor: Colors.bgCard },
  slotInitial: { fontFamily: "Rajdhani_700Bold", fontSize: 16, color: Colors.gold },
  slotInitialCompact: { fontSize: 13 },
  slotInfo: { flex: 1, gap: 1 },
  slotName: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.text },
  hostBadge: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.gold,
    letterSpacing: 0.5,
  },
  hostBadgeCompact: {
    fontSize: 10,
  },
  slotWaiting: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textMuted },
  teamBadge: { fontFamily: "Rajdhani_700Bold", fontSize: 13, letterSpacing: 1 },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, gap: 4 },
  waitingHost: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 10,
  },
  waitingText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textMuted },
});
