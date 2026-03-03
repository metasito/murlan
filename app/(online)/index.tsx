import React, { useState, useEffect } from "react";
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
  KeyboardAvoidingView,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useOnlineGame } from "@/context/OnlineGameContext";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import Colors from "@/constants/colors";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";

export default function OnlineLobbyScreen() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { user } = useAuth();
  const { createRoom, joinRoom, room, connected, error, clearError } = useOnlineGame();
  const { pendingInvite, clearInvite } = useSocket();
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [createMode, setCreateMode] = useState<"free_for_all" | "teams">("free_for_all");
  const [createPlayers, setCreatePlayers] = useState(4);

  const isLandscape = W > H;
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    if (room) {
      router.push("/(online)/room");
    }
  }, [room?.roomId]);

  useEffect(() => {
    if (error) {
      Alert.alert("Errore", error, [{ text: "OK", onPress: clearError }]);
    }
  }, [error]);

  useEffect(() => {
    if (pendingInvite) {
      setJoinCode(pendingInvite.roomCode);
      setJoinModalVisible(true);
      clearInvite();
    }
  }, [pendingInvite]);

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
    <View style={{ flex: 1 }}>
      <MenuCard title="CREA STANZA" style={isLandscape ? styles.compactCard : undefined}>
        <View style={isLandscape ? styles.optSectionLandscape : styles.optSection}>
          <Text style={styles.optLabelSmall}>MODALITÀ</Text>
          <View style={[styles.toggle, isLandscape && styles.gapXs]}>
            {(["free_for_all", "teams"] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => { setCreateMode(m); Haptics.selectionAsync(); }}
                style={[
                  styles.toggleBtn, 
                  createMode === m && styles.toggleActive,
                  isLandscape && styles.compactToggleBtn
                ]}
              >
                <Ionicons 
                  name={m === "teams" ? "people" : "person"} 
                  size={isLandscape ? 14 : 16} 
                  color={createMode === m ? Colors.gold : Colors.textSecondary} 
                />
                <Text style={[styles.toggleText, createMode === m && styles.toggleTextActive, isLandscape && { fontSize: 12 }]}>
                  {m === "free_for_all" ? "Libera" : "Coppie"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={isLandscape ? styles.optSectionLandscape : styles.optSection}>
          <Text style={styles.optLabelSmall}>GIOCATORI</Text>
          <View style={[styles.toggle, isLandscape && styles.gapXs]}>
            {[2, 3, 4].map((n) => (
              <Pressable
                key={n}
                onPress={() => { setCreatePlayers(n); Haptics.selectionAsync(); }}
                style={[
                  styles.toggleBtn, 
                  createPlayers === n && styles.toggleActive,
                  isLandscape && styles.compactToggleBtn
                ]}
              >
                <Text style={[styles.toggleText, createPlayers === n && styles.toggleTextActive, { fontSize: isLandscape ? 14 : 18 }]}>
                  {n}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {createMode === "teams" && createPlayers !== 4 && (
          <Text style={styles.warn}>La modalità Coppie richiede 4 giocatori</Text>
        )}

        <View style={{ marginTop: isLandscape ? 4 : 8 }}>
          <MenuButton
            label="Crea Stanza"
            onPress={handleCreate}
            variant="primary"
            fullWidth={true}
            style={isLandscape ? { minHeight: 44 } : undefined}
            disabled={createMode === "teams" && createPlayers !== 4}
            icon={<Ionicons name="add-circle-outline" size={20} color={createMode === "teams" && createPlayers !== 4 ? Colors.textMuted : "#0A1F18"} />}
          />
        </View>
      </MenuCard>
    </View>
  );

  const JoinSection = (
    <View style={{ flex: 1 }}>
      <MenuCard title="ENTRA IN UNA STANZA" style={isLandscape ? styles.compactCard : undefined}>
        <View style={{ paddingVertical: isLandscape ? 2 : 4 }}>
          <MenuButton
            label="Inserisci codice stanza"
            onPress={() => setJoinModalVisible(true)}
            variant="secondary"
            fullWidth={true}
            style={isLandscape ? { minHeight: 44 } : undefined}
            icon={<Ionicons name="enter-outline" size={20} color={Colors.gold} />}
          />
        </View>
      </MenuCard>
    </View>
  );

  return (
    <View style={[styles.container, {
      paddingTop: topPad,
      paddingLeft: isLandscape ? insets.left : 0,
      paddingRight: isLandscape ? insets.right : 0,
    }]}>
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

      {isLandscape ? (
        <View style={[styles.body, styles.bodyLandscape]}>
          <View style={styles.contentWrapperLandscape}>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: connected ? "#4CAF50" : Colors.textMuted }]} />
              <Text style={styles.statusText}>
                {connected ? `Connesso come ${user?.username}` : "Connessione…"}
              </Text>
            </View>

            <View style={styles.landscapeRow}>
              {CreateSection}
              <View style={styles.dividerV} />
              {JoinSection}
            </View>
          </View>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.body,
            { paddingBottom: bottomPad + 16 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.contentWrapper}>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: connected ? "#4CAF50" : Colors.textMuted }]} />
              <Text style={styles.statusText}>
                {connected ? `Connesso come ${user?.username}` : "Connessione…"}
              </Text>
            </View>

            {CreateSection}
            <View style={styles.divider}>
              <View style={styles.divLine} />
              <Text style={styles.divText}>oppure</Text>
              <View style={styles.divLine} />
            </View>
            {JoinSection}
          </View>
        </ScrollView>
      )}

      <Modal
        visible={joinModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setJoinModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <ScrollView 
            contentContainerStyle={styles.modalScroll}
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.modalBox, isLandscape && styles.modalBoxLandscape]}>
              <Text style={styles.modalTitle}>Entra in una stanza</Text>
              <MenuCard title="Codice Stanza" style={{ marginBottom: 0 }}>
                <TextInput
                  style={[styles.codeInput, isLandscape && styles.codeInputLandscape]}
                  value={joinCode}
                  onChangeText={(v) => setJoinCode(v.toUpperCase())}
                  placeholder="CODICE"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="characters"
                  maxLength={8}
                />
              </MenuCard>
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
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: {
    flex: 1,
    textAlign: "center",
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 20,
    color: Colors.text,
    letterSpacing: 1,
  },
  body: { paddingHorizontal: 20, paddingTop: 20, gap: 24 },
  bodyLandscape: { paddingTop: 16, gap: 16, flex: 1 },
  contentWrapper: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    gap: 16,
  },
  contentWrapperLandscape: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    flex: 1,
    gap: 8,
  },
  landscapeRow: { flexDirection: "row", gap: 20, alignItems: "stretch", flex: 1 },
  dividerV: { width: 1, backgroundColor: Colors.border, alignSelf: "stretch", marginHorizontal: 10 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textMuted },
  compactCard: { marginBottom: 4, paddingHorizontal: 8, paddingVertical: 8 },
  optSection: { gap: 10, marginBottom: 16 },
  optSectionLandscape: { gap: 4, marginBottom: 8 },
  optLabelSmall: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 2,
    marginBottom: 2,
  },
  toggle: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  gapXs: { gap: 4 },
  toggleBtn: {
    flex: 1,
    minWidth: 80,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgSurface,
  },
  compactToggleBtn: { paddingVertical: 8, minWidth: 60 },
  toggleActive: { 
    borderColor: Colors.gold, 
    backgroundColor: "rgba(201,168,76,0.12)" 
  },
  toggleText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 14, color: Colors.textSecondary },
  toggleTextActive: { color: Colors.gold },
  warn: { fontFamily: "Inter_400Regular", fontSize: 12, color: "#ff6b6b", marginBottom: 4 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12 },
  divLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  divText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted },
  modalOverlay: { 
    flex: 1, 
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  modalScroll: { 
    flexGrow: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 20 
  },
  modalBox: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    gap: 16,
  },
  modalBoxLandscape: {
    padding: 16,
    gap: 8,
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
  codeInputLandscape: {
    paddingVertical: 8,
    fontSize: 22,
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
