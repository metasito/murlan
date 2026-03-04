import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Share,
  Alert,
  FlatList,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useOnlineGame } from "@/context/OnlineGameContext";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { getSocket } from "@/lib/socket";
import Colors from "@/constants/colors";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";

const TEAM_COLORS = { A: Colors.gold, B: "#6b8ef5" };

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
  const { onlineIds } = useSocket();
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

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
        INVITA AMICI
      </Text>
      {onlineFriendsNotInRoom.length === 0 ? (
        <View style={[inviteStyles.emptyContainer, { backgroundColor: Colors.bgCard, borderRadius: 10 }]}>
          <Text style={inviteStyles.emptyText}>Nessun amico online</Text>
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
                style={({ pressed }) => [
                  inviteStyles.row,
                  { height: ROW_H },
                  pressed && { opacity: 0.8 },
                ]}
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
                  <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
                ) : (
                  <View style={inviteStyles.inviteBtn}>
                    <Text style={inviteStyles.inviteBtnText}>Invita</Text>
                  </View>
                )}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={inviteStyles.emptyText}>Nessun amico online</Text>
          }
        />
      )}
    </View>
  );
}

export default function RoomScreen() {
  const insets = useSafeAreaInsets();
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

  const isLandscape = W > H;
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const playerItemHeight = isLandscape ? 36 : 44;
  const playerItemPaddingVertical = isLandscape ? 4 : 8;
  const playerListGap = isLandscape ? 4 : 6;

  useEffect(() => {
    if (gameState) {
      router.replace("/(online)/game");
    }
  }, [!!gameState]);

  useEffect(() => {
    if (!room) {
      if (entrySource === "quickmatch") {
        router.replace("/(online)/quickmatch");
      } else {
        router.replace("/(online)");
      }
    }
  }, [room]);

  useEffect(() => {
    if (error) {
      Alert.alert("Errore", error, [{ text: "OK", onPress: clearError }]);
    }
  }, [error]);

  if (!room) return null;

  const isHost = room.hostUserId === user?.id;
  const canStart = isHost && room.players.length >= 2 && room.status === "waiting";
  const maxSeats = room.maxPlayers;
  const hasEmptySeats = room.players.length < maxSeats;
  const showInvitePanel = room.status === "waiting" && hasEmptySeats && !!user;

  async function handleCopyCode() {
    await Clipboard.setStringAsync(room!.code);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function handleShare() {
    await Share.share({ message: `Unisciti alla mia stanza Murlan! Codice: ${room!.code}` });
  }

  function handleLeave() {
    Alert.alert(
      "Lascia la stanza",
      "Sei sicuro di voler lasciare la stanza?",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Lascia",
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    startGame();
  }

  const modeLabel = room.gameMode === "teams" ? "A coppie" : "Tutti contro tutti";
  const modeIcon: "people" | "person" = room.gameMode === "teams" ? "people" : "person";

  const playerUserIds = room.players.map((p) => p.userId);

  const StartButton = isHost ? (
    <MenuButton
      label={room.players.length < 2 ? "In attesa di giocatori" : "Inizia Partita"}
      onPress={handleStart}
      disabled={!canStart}
      icon={<Ionicons name="play-circle" size={22} color={canStart ? "#0A1F18" : Colors.textMuted} />}
    />
  ) : (
    <View style={styles.waitingHost}>
      <Ionicons name="time-outline" size={18} color={Colors.textMuted} />
      <Text style={styles.waitingText}>In attesa che l'host avvii la partita…</Text>
    </View>
  );

  if (isLandscape) {
    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: topPad,
            paddingBottom: bottomPad,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        <LinearGradient
          colors={[Colors.bg, Colors.bgCard]}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.topBar}>
          <Pressable onPress={handleLeave} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={Colors.textMuted} />
          </Pressable>
          <Text style={styles.screenTitle}>Stanza</Text>
          <View style={{ width: 38 }} />
        </View>

        <View style={styles.landscapeBody}>
          {/* LEFT: code card, mode pill, start button */}
          <View style={styles.landscapeLeft}>
            <View style={{ flex: 1, gap: 8 }}>
              <Animated.View entering={FadeIn.duration(400)} style={styles.codeSectionCompact}>
                <Text style={styles.codeLabel}>CODICE STANZA</Text>
                <Text style={styles.codeTextCompact}>{room.code}</Text>
                <View style={styles.codeActions}>
                  <Pressable onPress={handleCopyCode} style={styles.codeBtn}>
                    <Ionicons name="copy-outline" size={15} color={Colors.gold} />
                    <Text style={styles.codeBtnText}>Copia</Text>
                  </Pressable>
                  <Pressable onPress={handleShare} style={styles.codeBtn}>
                    <Ionicons name="share-outline" size={15} color={Colors.gold} />
                    <Text style={styles.codeBtnText}>Condividi</Text>
                  </Pressable>
                </View>
              </Animated.View>

              <View style={styles.modePill}>
                <Ionicons name={modeIcon} size={13} color={Colors.textMuted} />
                <Text style={styles.modePillText}>
                  {modeLabel} · {room.maxPlayers} giocatori
                </Text>
              </View>
            </View>

            <View style={styles.landscapeFooter}>
              {StartButton}
            </View>
          </View>

          <View style={styles.landscapeDivider} />

          {/* RIGHT: giocatori + invita amici */}
          <View style={styles.landscapeRight}>
            <View style={{ gap: 4, marginBottom: 8 }}>
              <Text style={[styles.slotsSectionTitle, { marginBottom: 2 }]}>
                GIOCATORI ({room.players.length}/{maxSeats})
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
                              {player.userId === user?.id ? " (tu)" : ""}
                            </Text>
                            {room.hostUserId === player.userId && (
                              <Text style={[styles.hostBadge, styles.hostBadgeCompact]}>Host</Text>
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
                          <Text style={[styles.slotWaiting, { marginLeft: 8 }]}>In attesa…</Text>
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
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { paddingTop: topPad, paddingBottom: bottomPad + 8 },
      ]}
    >
      <LinearGradient
        colors={[Colors.bg, Colors.bgCard]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.topBar}>
        <Pressable onPress={handleLeave} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={Colors.textMuted} />
        </Pressable>
        <Text style={styles.screenTitle}>Stanza</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 12 }}>
        <Animated.View entering={FadeIn.duration(400)} style={styles.codeSection}>
          <Text style={styles.codeLabel}>CODICE STANZA</Text>
          <Text style={styles.codeText}>{room.code}</Text>
          <View style={styles.codeActions}>
            <Pressable onPress={handleCopyCode} style={styles.codeBtn}>
              <Ionicons name="copy-outline" size={16} color={Colors.gold} />
              <Text style={styles.codeBtnText}>Copia</Text>
            </Pressable>
            <Pressable onPress={handleShare} style={styles.codeBtn}>
              <Ionicons name="share-outline" size={16} color={Colors.gold} />
              <Text style={styles.codeBtnText}>Condividi</Text>
            </Pressable>
          </View>
        </Animated.View>

        <View style={styles.modePill}>
          <Ionicons name={modeIcon} size={13} color={Colors.textMuted} />
          <Text style={styles.modePillText}>
            {modeLabel} · {room.maxPlayers} giocatori
          </Text>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={[styles.slotsSectionTitle, { marginBottom: 2 }]}>
            GIOCATORI ({room.players.length}/{maxSeats})
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
                          {player.userId === user?.id ? " (tu)" : ""}
                        </Text>
                        {room.hostUserId === player.userId && (
                          <Text style={styles.hostBadge}>Host</Text>
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
                      <Text style={[styles.slotWaiting, { marginLeft: 12 }]}>In attesa…</Text>
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
    </View>
  );
}

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
    backgroundColor: "#4CAF50",
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
  container: { flex: 1, backgroundColor: Colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { padding: 8 },
  screenTitle: {
    flex: 1,
    textAlign: "center",
    fontFamily: "Rajdhani_700Bold",
    fontSize: 20,
    color: Colors.text,
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
  codeBtn: { flexDirection: "row", alignItems: "center", gap: 6, padding: 4 },
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
