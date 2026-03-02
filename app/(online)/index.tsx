import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Platform,
  Modal,
  Alert,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useOnlineGame } from "@/context/OnlineGameContext";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

export default function OnlineLobbyScreen() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { user } = useAuth();
  const { createRoom, joinRoom, room, connected, error, clearError } = useOnlineGame();
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [createMode, setCreateMode] = useState<"free_for_all" | "teams">("free_for_all");
  const [createPlayers, setCreatePlayers] = useState(4);

  const isLandscape = W > H;
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  React.useEffect(() => {
    if (room) {
      router.push("/(online)/room");
    }
  }, [room?.roomId]);

  React.useEffect(() => {
    if (error) {
      Alert.alert("Errore", error, [{ text: "OK", onPress: clearError }]);
    }
  }, [error]);

  function handleCreate() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    createRoom(createMode, createPlayers);
  }

  function handleJoin() {
    if (joinCode.length < 4) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    joinRoom(joinCode.trim().toUpperCase());
    setJoinModalVisible(false);
    setJoinCode("");
  }

  const CreateSection = (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>CREA STANZA</Text>

      <View style={styles.optRow}>
        <Text style={styles.optLabel}>Modalità</Text>
        <View style={styles.toggle}>
          {(["free_for_all", "teams"] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => setCreateMode(m)}
              style={[styles.toggleBtn, createMode === m && styles.toggleActive]}
            >
              <Text style={[styles.toggleText, createMode === m && styles.toggleTextActive]}>
                {m === "free_for_all" ? "Libera" : "Coppie"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.optRow}>
        <Text style={styles.optLabel}>Giocatori</Text>
        <View style={styles.toggle}>
          {[2, 3, 4].map((n) => (
            <Pressable
              key={n}
              onPress={() => setCreatePlayers(n)}
              style={[styles.toggleBtn, createPlayers === n && styles.toggleActive]}
            >
              <Text style={[styles.toggleText, createPlayers === n && styles.toggleTextActive]}>
                {n}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {createMode === "teams" && createPlayers !== 4 && (
        <Text style={styles.warn}>La modalità Coppie richiede 4 giocatori</Text>
      )}

      <Pressable
        onPress={handleCreate}
        disabled={createMode === "teams" && createPlayers !== 4}
        style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
      >
        <LinearGradient
          colors={[Colors.gold, Colors.goldDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.primaryGrad}
        >
          <Ionicons name="add-circle-outline" size={20} color="#0A1F18" />
          <Text style={styles.primaryBtnText}>Crea Stanza</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );

  const JoinSection = (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>ENTRA IN UNA STANZA</Text>
      <Pressable
        onPress={() => setJoinModalVisible(true)}
        style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.85 }]}
      >
        <Ionicons name="enter-outline" size={20} color={Colors.gold} />
        <Text style={styles.secondaryBtnText}>Inserisci codice stanza</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad + 16 }]}>
      <LinearGradient
        colors={[Colors.bg, Colors.bgCard]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={Colors.textMuted} />
        </Pressable>
        <Text style={styles.screenTitle}>Con Amici</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          isLandscape && styles.bodyLandscape,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: connected ? "#4CAF50" : Colors.textMuted }]} />
          <Text style={styles.statusText}>
            {connected ? `Connesso come ${user?.username}` : "Connessione…"}
          </Text>
        </View>

        {isLandscape ? (
          <View style={styles.landscapeRow}>
            <View style={{ flex: 1 }}>{CreateSection}</View>
            <View style={styles.dividerV} />
            <View style={{ flex: 1 }}>{JoinSection}</View>
          </View>
        ) : (
          <>
            {CreateSection}
            <View style={styles.divider}>
              <View style={styles.divLine} />
              <Text style={styles.divText}>oppure</Text>
              <View style={styles.divLine} />
            </View>
            {JoinSection}
          </>
        )}
      </ScrollView>

      <Modal
        visible={joinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setJoinModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Entra in una stanza</Text>
            <TextInput
              style={styles.codeInput}
              value={joinCode}
              onChangeText={(v) => setJoinCode(v.toUpperCase())}
              placeholder="CODICE"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="characters"
              maxLength={8}
              autoFocus
            />
            <View style={styles.modalRow}>
              <Pressable
                onPress={() => { setJoinModalVisible(false); setJoinCode(""); }}
                style={styles.modalCancelBtn}
              >
                <Text style={styles.modalCancelText}>Annulla</Text>
              </Pressable>
              <Pressable
                onPress={handleJoin}
                disabled={joinCode.length < 4}
                style={({ pressed }) => [styles.modalOkBtn, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.modalOkText}>Entra</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, gap: 16 },
  bodyLandscape: { paddingTop: 12, gap: 12 },
  landscapeRow: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
  dividerV: { width: 1, backgroundColor: Colors.border, alignSelf: "stretch" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textMuted },
  section: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
    gap: 14,
  },
  sectionTitle: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.gold,
    letterSpacing: 2,
  },
  optRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  optLabel: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.text },
  toggle: { flexDirection: "row", gap: 6 },
  toggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  toggleActive: { borderColor: Colors.gold, backgroundColor: "rgba(201,168,76,0.12)" },
  toggleText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 14, color: Colors.textMuted },
  toggleTextActive: { color: Colors.gold },
  warn: { fontFamily: "Inter_400Regular", fontSize: 12, color: "#ff6b6b" },
  primaryBtn: { borderRadius: 12, overflow: "hidden" },
  primaryGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 },
  primaryBtnText: { fontFamily: "Rajdhani_700Bold", fontSize: 17, color: "#0A1F18", letterSpacing: 0.5 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12 },
  divLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  divText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.gold,
    paddingVertical: 14,
  },
  secondaryBtnText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 16, color: Colors.gold },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center" },
  modalBox: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 24,
    width: 300,
    gap: 16,
  },
  modalTitle: { fontFamily: "Rajdhani_700Bold", fontSize: 20, color: Colors.text, textAlign: "center" },
  codeInput: {
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontFamily: "Rajdhani_700Bold",
    fontSize: 28,
    textAlign: "center",
    letterSpacing: 6,
    paddingVertical: 14,
  },
  modalRow: { flexDirection: "row", gap: 12 },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
  },
  modalCancelText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 16, color: Colors.textMuted },
  modalOkBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.gold,
    alignItems: "center",
  },
  modalOkText: { fontFamily: "Rajdhani_700Bold", fontSize: 16, color: "#0A1F18" },
});
