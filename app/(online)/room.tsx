import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Share,
  Alert,
  ScrollView,
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
  compact,
}: {
  roomCode: string;
  playerUserIds: string[];
  myUserId: string;
  compact?: boolean;
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

  const ROW_H = compact ? 36 : 40;
  const maxVisible = 3;
  const listMaxHeight = ROW_H * maxVisible + 8;
  const hasMore = onlineFriendsNotInRoom.length > maxVisible;

  return (
    <MenuCard title="Invita Amici" style={{ marginBottom: 0, flex: compact ? 1 : undefined }}>
      {onlineFriendsNotInRoom.length === 0 ? (
        <Text style={inviteStyles.emptyText}>Nessun amico online</Text>
      ) : (
        <View style={{ maxHeight: listMaxHeight, position: "relative" }}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {onlineFriendsNotInRoom.map((friend) => {
              const sent = sentIds.has(friend.id);
              return (
                <Pressable
                  key={friend.id}
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
            })}
          </ScrollView>
          {hasMore && (
            <LinearGradient
              colors={["transparent", "rgba(3,16,8,0.92)"]}
              style={inviteStyles.fadeGradient}
              pointerEvents="none"
            />
          )}
        </View>
      )}
    </MenuCard>
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

  const SlotsGrid = (
    <View style={styles.slotsSection}>
      <Text style={styles.slotsSectionTitle}>
        GIOCATORI ({room.players.length}/{maxSeats})
      </Text>
      <View style={styles.slotsGrid}>
        {Array.from({ length: maxSeats }, (_, i) => {
          const player = room.players.find((p) => p.seatIndex === i);
          const team = room.gameMode === "teams" ? (i % 2 === 0 ? "A" : "B") : null;
          return (
            <MenuCard
              key={i}
              style={[
                isLandscape ? styles.slotCardCompact : styles.slotCard,
                team ? { borderLeftColor: TEAM_COLORS[team as "A" | "B"], borderLeftWidth: 3 } : undefined,
              ]}
            >
              <View style={[styles.slotInner, isLandscape && styles.slotInnerCompact]}>
                {player ? (
                  <>
                    <View style={[styles.slotAvatar, isLandscape && styles.slotAvatarCompact]}>
                      <Text style={[styles.slotInitial, isLandscape && styles.slotInitialCompact]}>
                        {player.username.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.slotInfo}>
                      <Text style={styles.slotName} numberOfLines={1}>
                        {player.username}
                        {player.userId === user?.id ? " (tu)" : ""}
                      </Text>
                      {room.hostUserId === player.userId && (
                        <Text style={[styles.hostBadge, isLandscape && styles.hostBadgeCompact]}>
                          Host
                        </Text>
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
                    <View style={[styles.slotAvatar, styles.slotAvatarEmpty, isLandscape && styles.slotAvatarCompact]}>
                      <Ionicons name="person-add-outline" size={isLandscape ? 14 : 18} color={Colors.textMuted} />
                    </View>
                    <Text style={styles.slotWaiting}>In attesa…</Text>
                  </>
                )}
              </View>
            </MenuCard>
          );
        })}
      </View>
    </View>
  );

  const FooterContent = (
    <>
      {isHost ? (
        <MenuButton
          label={room.players.length < 2 ? "In attesa di giocatori…" : "Inizia Partita"}
          onPress={handleStart}
          disabled={!canStart}
          icon={<Ionicons name="play-circle" size={22} color={canStart ? "#0A1F18" : Colors.textMuted} />}
        />
      ) : (
        <View style={styles.waitingHost}>
          <Ionicons name="time-outline" size={18} color={Colors.textMuted} />
          <Text style={styles.waitingText}>In attesa che l'host avvii la partita…</Text>
        </View>
      )}
      <MenuButton
        label="Lascia Stanza"
        onPress={handleLeave}
        variant="danger"
      />
    </>
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
          <View style={styles.landscapeLeft}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.landscapeLeftContent}
              showsVerticalScrollIndicator={false}
            >
              <Animated.View
                entering={FadeIn.duration(400)}
                style={styles.codeSectionCompact}
              >
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

              {showInvitePanel && (
                <InviteFriendsPanel
                  roomCode={room.code}
                  playerUserIds={playerUserIds}
                  myUserId={user!.id}
                  compact
                />
              )}
            </ScrollView>

            <View style={styles.landscapeFooter}>
              {FooterContent}
            </View>
          </View>

          <View style={styles.landscapeDivider} />

          <ScrollView
            style={styles.landscapeRight}
            contentContainerStyle={{ paddingVertical: 4 }}
            showsVerticalScrollIndicator={false}
          >
            {SlotsGrid}
          </ScrollView>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { paddingTop: topPad, paddingBottom: bottomPad + 16 },
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

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
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

        {SlotsGrid}

        {showInvitePanel && (
          <InviteFriendsPanel
            roomCode={room.code}
            playerUserIds={playerUserIds}
            myUserId={user!.id}
          />
        )}
      </ScrollView>

      <View style={styles.footer}>{FooterContent}</View>
    </View>
  );
}

const inviteStyles = StyleSheet.create({
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 2,
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
  fadeGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 28,
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
  body: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, gap: 16 },

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
  landscapeLeftContent: {
    gap: 10,
    paddingTop: 4,
    paddingBottom: 8,
  },
  landscapeDivider: {
    width: 1,
    backgroundColor: Colors.border,
    marginRight: 12,
  },
  landscapeRight: {
    flex: 1,
    paddingRight: 8,
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
    padding: 20,
    alignItems: "center",
    gap: 8,
  },
  codeSectionCompact: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    padding: 12,
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

  slotsSection: { gap: 8 },
  slotsSectionTitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  slotsGrid: { gap: 6 },
  slotCard: {
    marginBottom: 0,
    minHeight: 68,
  },
  slotCardCompact: {
    marginBottom: 0,
    minHeight: 44,
    paddingVertical: 2,
  },
  slotInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 40,
  },
  slotInnerCompact: {
    minHeight: 32,
    gap: 8,
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
