import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  ScrollView,
  useWindowDimensions,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { hapticMedium, hapticSelection } from "@/lib/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useOnlineGame } from "@/context/OnlineGameContext";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { Colors, Spacing, FontSize, Type } from '@/lib/theme';
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { useTranslation } from "@/lib/i18n";

export default function OnlineLobbyScreen() {
  const { t } = useTranslation();
  const { width: W, height: H } = useWindowDimensions();
  const { user } = useAuth();
  const { createRoom, joinRoom, room, connected, error, clearError } = useOnlineGame();
  const { pendingInvite, clearInvite } = useSocket();
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [createMode, setCreateMode] = useState<"free_for_all" | "teams">("free_for_all");
  const [createPlayers, setCreatePlayers] = useState(4);

  const isLandscape = W > H;

  useEffect(() => {
    if (room) {
      router.push("/(online)/room");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate once per room id, not on every room field update
  }, [room?.roomId]);

  useEffect(() => {
    if (error) {
      Alert.alert(t("common.error"), error, [{ text: t("common.ok"), onPress: clearError }]);
    }
  }, [error, clearError, t]);

  useEffect(() => {
    if (pendingInvite) {
      setJoinCode(pendingInvite.roomCode);
      setJoinModalVisible(true);
      clearInvite();
    }
  }, [pendingInvite, clearInvite]);

  function handleCreate() {
    hapticMedium();
    createRoom(createMode, createPlayers);
  }

  function handleJoin() {
    if (joinCode.length < 4) return;
    hapticMedium();
    joinRoom(joinCode.trim().toUpperCase());
    setJoinModalVisible(false);
    setJoinCode("");
  }

  const CreateSection = (
    <View style={{ flex: 1 }}>
      <MenuCard title={t("onlineLobby.createRoomTitle")} style={isLandscape ? styles.compactCard : undefined}>
        <View style={isLandscape ? styles.optSectionLandscape : styles.optSection}>
          <Text style={styles.optLabelSmall}>{t("onlineLobby.modeLabel")}</Text>
          <View style={[styles.toggle, isLandscape && styles.gapXs]}>
            {(["free_for_all", "teams"] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => { setCreateMode(m); hapticSelection(); }}
                style={[
                  styles.toggleBtn,
                  createMode === m && styles.toggleActive,
                  isLandscape && styles.compactToggleBtn
                ]}
                accessibilityRole="radio"
                accessibilityLabel={m === "free_for_all" ? t("onlineLobby.modeFreeForAll") : t("onlineLobby.modeTeams")}
                accessibilityState={{ selected: createMode === m }}
              >
                <Ionicons 
                  name={m === "teams" ? "people" : "person"} 
                  size={isLandscape ? 14 : 16} 
                  color={createMode === m ? Colors.gold : Colors.textSecondary} 
                />
                <Text style={[styles.toggleText, createMode === m && styles.toggleTextActive, isLandscape && { fontSize: 12 }]}>
                  {m === "free_for_all" ? t("onlineLobby.modeFreeForAll") : t("onlineLobby.modeTeams")}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={isLandscape ? styles.optSectionLandscape : styles.optSection}>
          <Text style={styles.optLabelSmall}>{t("onlineLobby.playersLabel")}</Text>
          <View style={[styles.toggle, isLandscape && styles.gapXs]}>
            {[2, 3, 4].map((n) => (
              <Pressable
                key={n}
                onPress={() => { setCreatePlayers(n); hapticSelection(); }}
                style={[
                  styles.toggleBtn,
                  createPlayers === n && styles.toggleActive,
                  isLandscape && styles.compactToggleBtn
                ]}
                accessibilityRole="radio"
                accessibilityLabel={t("lobby.playerCountOptionA11yLabel", { n })}
                accessibilityState={{ selected: createPlayers === n }}
              >
                <Text style={[styles.toggleText, createPlayers === n && styles.toggleTextActive, { fontSize: isLandscape ? 14 : 18 }]}>
                  {n}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {createMode === "teams" && createPlayers !== 4 && (
          <Text style={styles.warn}>{t("onlineLobby.teamsRequire4")}</Text>
        )}

        <View style={{ marginTop: isLandscape ? 4 : 8 }}>
          <MenuButton
            label={t("onlineLobby.createRoom")}
            onPress={handleCreate}
            variant="primary"
            fullWidth={true}
            style={isLandscape ? { minHeight: 44 } : undefined}
            disabled={createMode === "teams" && createPlayers !== 4}
            icon={<Ionicons name="add-circle-outline" size={20} color={createMode === "teams" && createPlayers !== 4 ? Colors.textMuted : Colors.bg} />}
          />
        </View>
      </MenuCard>
    </View>
  );

  const JoinSection = (
    <View style={{ flex: 1 }}>
      <MenuCard title={t("onlineLobby.joinRoomTitle")} style={isLandscape ? styles.compactCard : undefined}>
        <View style={{ paddingVertical: isLandscape ? 2 : 4 }}>
          <MenuButton
            label={t("onlineLobby.enterRoomCode")}
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
    <MenuLayout scrollable={false} centered={false} style={{ paddingBottom: 0 }}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={22} color={Colors.gold} />
        </Pressable>
        <Text style={styles.screenTitle}>{t("onlineLobby.title")}</Text>
        <View style={{ width: 38 }} />
      </View>

      {isLandscape ? (
        <View style={[styles.body, styles.bodyLandscape]}>
          <View style={styles.contentWrapperLandscape}>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: connected ? Colors.success : Colors.textMuted }]} />
              <Text style={styles.statusText}>
                {connected ? t("onlineLobby.connectedAs", { username: user?.username ?? "" }) : t("onlineLobby.connecting")}
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
          contentContainerStyle={[styles.body, { paddingBottom: Spacing.lg }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.contentWrapper}>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: connected ? Colors.success : Colors.textMuted }]} />
              <Text style={styles.statusText}>
                {connected ? t("onlineLobby.connectedAs", { username: user?.username ?? "" }) : t("onlineLobby.connecting")}
              </Text>
            </View>

            {CreateSection}
            <View style={styles.divider}>
              <View style={styles.divLine} />
              <Text style={styles.divText}>{t("onlineLobby.or")}</Text>
              <View style={styles.divLine} />
            </View>
            {JoinSection}
          </View>
        </ScrollView>
      )}

      {joinModalVisible && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={[styles.modalOverlay, { pointerEvents: "box-none" as const }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => { setJoinModalVisible(false); setJoinCode(""); }} />
          <ScrollView
            contentContainerStyle={styles.modalScroll}
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.modalBox, isLandscape && styles.modalBoxLandscape, { width: isLandscape ? "80%" : "100%", maxWidth: isLandscape ? 600 : 400 }]}>
              <Text style={styles.modalTitle}>{t("onlineLobby.joinModalTitle")}</Text>
              <MenuCard title={t("onlineLobby.roomCodeCardTitle")} style={{ marginBottom: 0 }}>
                <TextInput
                  style={[styles.codeInput, isLandscape && styles.codeInputLandscape]}
                  value={joinCode}
                  onChangeText={(v) => setJoinCode(v.toUpperCase())}
                  placeholder={t("onlineLobby.roomCodePlaceholder")}
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="characters"
                  autoFocus={true}
                  maxLength={8}
                  accessibilityLabel={t("onlineLobby.roomCodeA11yLabel")}
                  accessibilityHint={t("onlineLobby.roomCodeA11yHint")}
                />
              </MenuCard>
              <View style={styles.modalRow}>
                <Pressable
                  onPress={() => { setJoinModalVisible(false); setJoinCode(""); }}
                  style={styles.modalCancelBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t("common.cancel")}
                >
                  <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
                </Pressable>
                <Pressable
                  onPress={handleJoin}
                  disabled={joinCode.length < 4}
                  style={({ pressed }) => [styles.modalOkBtn, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={t("onlineLobby.enter")}
                  accessibilityState={{ disabled: joinCode.length < 4 }}
                >
                  <Text style={styles.modalOkText}>{t("onlineLobby.enter")}</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </MenuLayout>
  );
}

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
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: {
    flex: 1,
    textAlign: "center",
    ...Type.heading,
    fontSize: FontSize.xl,
    letterSpacing: 3,
  },
  body: { gap: 24 },
  bodyLandscape: { gap: 16, flex: 1 },
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
    backgroundColor: Colors.goldMuted,
  },
  toggleText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 14, color: Colors.textSecondary },
  toggleTextActive: { color: Colors.gold },
  warn: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.dangerDim, marginBottom: 4 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12 },
  divLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  divText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
    zIndex: 100,
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
  modalOkText: { fontFamily: "Rajdhani_700Bold", fontSize: 16, color: Colors.bg },
});
