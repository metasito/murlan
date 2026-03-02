import React, { useEffect } from "react";
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
import { useOnlineGame } from "@/context/OnlineGameContext";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const TEAM_COLORS = { A: Colors.gold, B: "#6b8ef5" };

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
            <View
              key={i}
              style={[
                styles.slot,
                player && styles.slotFilled,
                team && { borderLeftColor: TEAM_COLORS[team as "A" | "B"], borderLeftWidth: 3 },
              ]}
            >
              {player ? (
                <>
                  <View style={styles.slotAvatar}>
                    <Text style={styles.slotInitial}>
                      {player.username.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.slotInfo}>
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
                  <Text style={styles.slotWaiting}>In attesa…</Text>
                </>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );

  const FooterContent = (
    <>
      {isHost ? (
        <Pressable
          onPress={handleStart}
          disabled={!canStart}
          style={({ pressed }) => [
            styles.startBtn,
            !canStart && styles.startBtnDisabled,
            pressed && { opacity: 0.85 },
          ]}
        >
          <LinearGradient
            colors={canStart ? [Colors.gold, Colors.goldDark] : [Colors.bgSurface, Colors.bgSurface]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.startGrad}
          >
            <Ionicons
              name="play-circle"
              size={22}
              color={canStart ? "#0A1F18" : Colors.textMuted}
            />
            <Text style={[styles.startText, !canStart && { color: Colors.textMuted }]}>
              {room.players.length < 2 ? "In attesa di giocatori…" : "Inizia Partita"}
            </Text>
          </LinearGradient>
        </Pressable>
      ) : (
        <View style={styles.waitingHost}>
          <Ionicons name="time-outline" size={18} color={Colors.textMuted} />
          <Text style={styles.waitingText}>In attesa che l'host avvii la partita…</Text>
        </View>
      )}
    </>
  );

  if (isLandscape) {
    return (
      <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad }]}>
        <LinearGradient colors={[Colors.bg, Colors.bgCard]} style={StyleSheet.absoluteFill} />

        <View style={styles.topBar}>
          <Pressable onPress={handleLeave} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={Colors.textMuted} />
          </Pressable>
          <Text style={styles.screenTitle}>Stanza</Text>
          <View style={{ width: 38 }} />
        </View>

        <View style={styles.landscapeBody}>
          <View style={styles.landscapeLeft}>
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
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad + 16 }]}>
      <LinearGradient colors={[Colors.bg, Colors.bgCard]} style={StyleSheet.absoluteFill} />

      <View style={styles.topBar}>
        <Pressable onPress={handleLeave} style={styles.backBtn}>
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
      </ScrollView>

      <View style={styles.footer}>
        {FooterContent}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 8,
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
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 0,
  },
  landscapeLeft: {
    width: 220,
    gap: 12,
    paddingRight: 16,
  },
  landscapeDivider: {
    width: 1,
    backgroundColor: Colors.border,
    marginRight: 16,
  },
  landscapeRight: {
    flex: 1,
  },
  landscapeFooter: {
    marginTop: "auto",
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
    padding: 14,
    alignItems: "center",
    gap: 6,
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
    fontSize: 28,
    color: Colors.gold,
    letterSpacing: 6,
  },
  codeActions: { flexDirection: "row", gap: 20, marginTop: 4 },
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
  slotsSection: { gap: 10 },
  slotsSectionTitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  slotsGrid: { gap: 8 },
  slot: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 12,
    minHeight: 60,
  },
  slotFilled: { borderColor: "rgba(201,168,76,0.3)" },
  slotAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.felt,
    alignItems: "center",
    justifyContent: "center",
  },
  slotAvatarEmpty: { backgroundColor: Colors.bgCard },
  slotInitial: { fontFamily: "Rajdhani_700Bold", fontSize: 16, color: Colors.gold },
  slotInfo: { flex: 1, gap: 2 },
  slotName: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.text },
  hostBadge: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.gold,
    letterSpacing: 0.5,
  },
  slotWaiting: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textMuted },
  teamBadge: { fontFamily: "Rajdhani_700Bold", fontSize: 13, letterSpacing: 1 },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  startBtn: { borderRadius: 14, overflow: "hidden" },
  startBtnDisabled: {},
  startGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14 },
  startText: { fontFamily: "Rajdhani_700Bold", fontSize: 18, color: "#0A1F18", letterSpacing: 0.5 },
  waitingHost: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
  },
  waitingText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textMuted },
});
