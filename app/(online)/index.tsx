import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  useWindowDimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { hapticMedium, hapticSelection } from "@/lib/haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useOnlineGame } from "@/context/OnlineGameContext";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { Colors, Spacing, FontSize, Radius, TOUCH_TARGET_MIN, Type } from '@/lib/theme';
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden, a11yState, useA11yHint } from "@/lib/a11y";
import { usePrefersReducedMotion } from "@/lib/accessibility";

export default function OnlineLobbyScreen() {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const roomCodeHint = useA11yHint(t("onlineLobby.roomCodeA11yHint"));
  const watchHint = useA11yHint(t("onlineLobby.watchA11yHint"));
  const { width: W, height: H } = useWindowDimensions();
  const { user } = useAuth();
  const { createRoom, joinRoom, spectateRoom, room, gameState, isSpectator, connected, error, clearError } = useOnlineGame();
  const { pendingInvite, clearInvite } = useSocket();
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [createMode, setCreateMode] = useState<"free_for_all" | "teams">("free_for_all");
  const [createPlayers, setCreatePlayers] = useState(4);

  const isLandscape = W > H;

  // The id, not the room: every field update would otherwise push the route again.
  const roomId = room?.roomId;
  useEffect(() => {
    if (roomId) {
      router.push("/(online)/room");
    }
  }, [roomId]);

  // The table a spectate asked for, once the server has actually sent it. Four
  // refusals answer `room:spectate` with a `room:error` and no state at all, so
  // the request alone is not enough to leave the lobby on — and the refusal is
  // rendered here, where nothing on the game screen would show it.
  const watching = isSpectator && gameState !== null;
  useEffect(() => {
    if (watching) router.push("/(online)/game");
  }, [watching]);

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

  function closeJoin() {
    setJoinModalVisible(false);
    setJoinCode("");
  }

  function handleJoin() {
    if (joinCode.length < 4) return;
    hapticMedium();
    joinRoom(joinCode.trim().toUpperCase());
    closeJoin();
  }

  function handleSpectate() {
    if (joinCode.length < 4) return;
    hapticMedium();
    spectateRoom(joinCode.trim().toUpperCase());
    closeJoin();
  }

  // `flex: 1` is for the landscape row, where the two sections share the width.
  // Stacked in the portrait ScrollView it makes them fight over the container's
  // height instead of sizing to their content, and they end up overlapping —
  // the "oppure" divider landed on top of the create button and swallowed its
  // taps, so a room could not be created on a phone in portrait at all.
  const sectionFlex = isLandscape ? styles.sectionFlex : undefined;

  const CreateSection = (
    <View style={sectionFlex}>
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
                accessibilityLabel={m === "free_for_all" ? t("onlineLobby.modeFreeForAll") : t("onlineLobby.modeTeams")}
                {...a11yState({ role: "radio", selected: createMode === m })}
              >
                <Ionicons 
                  name={m === "teams" ? "people" : "person"} 
                  size={isLandscape ? 14 : 16} 
                  color={createMode === m ? Colors.gold : Colors.textSecondary} 
                />
                <Text style={[styles.toggleText, createMode === m && styles.toggleTextActive, isLandscape && { fontSize: FontSize.xs }]}>
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
                accessibilityLabel={t("lobby.playerCountOptionA11yLabel", { n })}
                {...a11yState({ role: "radio", selected: createPlayers === n })}
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
            style={isLandscape ? { minHeight: TOUCH_TARGET_MIN } : undefined}
            disabled={createMode === "teams" && createPlayers !== 4}
            icon={<Ionicons name="add-circle-outline" size={20} color={createMode === "teams" && createPlayers !== 4 ? Colors.textMuted : Colors.bg} />}
          />
        </View>
      </MenuCard>
    </View>
  );

  const JoinSection = (
    <View style={sectionFlex}>
      <MenuCard title={t("onlineLobby.joinRoomTitle")} style={isLandscape ? styles.compactCard : undefined}>
        <View style={{ paddingVertical: isLandscape ? 2 : 4 }}>
          <MenuButton
            label={t("onlineLobby.enterRoomCode")}
            onPress={() => setJoinModalVisible(true)}
            variant="secondary"
            fullWidth={true}
            style={isLandscape ? { minHeight: TOUCH_TARGET_MIN } : undefined}
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

      {/* In the layout flow, not over it: an absolutely positioned banner comes
          to rest on the create button and swallows its taps. `Alert` is not an
          option — react-native-web implements it as a no-op. */}
      {error && (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Ionicons
            name="alert-circle"
            size={16}
            color={Colors.white}
            {...a11yHidden()}
          />
          {/* Capped rather than free to wrap: this sits above a body that has
              nowhere to scroll, so a long message would take its height out of
              the cards below. */}
          <Text style={styles.errorBannerText} numberOfLines={2}>
            {error}
          </Text>
          {/* 16pt icon, so the slop lands on both edges to reach the floor: a declared
              box would take the banner from 32pt to 60 on a single-line message. */}
          <Pressable
            onPress={clearError}
            hitSlop={Spacing.wide}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <Ionicons
              name="close"
              size={16}
              color={Colors.white}
              {...a11yHidden()}
            />
          </Pressable>
        </View>
      )}

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

      <Modal
        visible={joinModalVisible}
        transparent
        animationType={reduceMotion ? "none" : "fade"}
        onRequestClose={closeJoin}
        statusBarTranslucent
        // iOS defaults this to portrait only, which rotates the whole app when the
        // modal opens in landscape and leaves the screen behind it mis-laid-out.
        supportedOrientations={["portrait", "landscape"]}
        accessibilityLabel={t("onlineLobby.joinModalTitle")}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={closeJoin} {...a11yHidden()} />
          <ScrollView
            contentContainerStyle={styles.modalScroll}
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            <View
              style={[styles.modalBox, isLandscape && styles.modalBoxLandscape, { width: isLandscape ? "80%" : "100%", maxWidth: isLandscape ? 600 : 400 }]}
              accessibilityViewIsModal
              accessibilityRole="none"
            >
              {/* A Modal's own host view is not an accessibility element on iOS,
                  so the label above it reaches web only; this is what VoiceOver
                  lands on and what confines it to the sheet. */}
              <Text style={styles.modalTitle} accessibilityRole="header">
                {t("onlineLobby.joinModalTitle")}
              </Text>
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
                  {...roomCodeHint.props}
                />
                {roomCodeHint.node}
              </MenuCard>
              <View style={styles.modalRow}>
                <Pressable
                  onPress={closeJoin}
                  style={styles.modalCancelBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t("common.cancel")}
                >
                  <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
                </Pressable>
                <Pressable
                  onPress={handleSpectate}
                  disabled={joinCode.length < 4}
                  style={({ pressed }) => [styles.modalCancelBtn, pressed && { opacity: 0.85 }]}
                  accessibilityLabel={t("onlineLobby.watch")}
                  {...watchHint.props}
                  {...a11yState({ role: "button", disabled: joinCode.length < 4 })}
                >
                  {watchHint.node}
                  <Text style={styles.modalCancelText}>{t("onlineLobby.watch")}</Text>
                </Pressable>
                <Pressable
                  onPress={handleJoin}
                  disabled={joinCode.length < 4}
                  style={({ pressed }) => [styles.modalOkBtn, pressed && { opacity: 0.85 }]}
                  accessibilityLabel={t("onlineLobby.enter")}
                  {...a11yState({ role: "button", disabled: joinCode.length < 4 })}
                >
                  <Text style={styles.modalOkText}>{t("onlineLobby.enter")}</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
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
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
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
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.dangerScrim,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  errorBannerText: {
    ...Type.body,
    color: Colors.white,
    flex: 1,
  },
  body: { gap: Spacing.lg },
  bodyLandscape: { gap: Spacing.md, flex: 1 },
  contentWrapper: {
    gap: Spacing.md,
  },
  contentWrapperLandscape: {
    flex: 1,
    gap: Spacing.sm,
  },
  landscapeRow: { flexDirection: "row", gap: Spacing.roomy, alignItems: "stretch", flex: 1 },
  dividerV: { width: 1, backgroundColor: Colors.border, alignSelf: "stretch", marginHorizontal: Spacing.snug },
  statusRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.xs },
  dot: { width: 8, height: 8, borderRadius: Radius.full },
  statusText: { fontFamily: "Inter_400Regular", fontSize: FontSize.sm, color: Colors.textMuted },
  compactCard: { marginBottom: Spacing.xs, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm },
  optSection: { gap: Spacing.snug, marginBottom: Spacing.md },
  optSectionLandscape: { gap: Spacing.xs, marginBottom: Spacing.sm },
  optLabelSmall: {
    fontFamily: "Inter_600SemiBold",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    letterSpacing: 2,
    marginBottom: Spacing.xxs,
  },
  toggle: { flexDirection: "row", gap: Spacing.snug, flexWrap: "wrap" },
  gapXs: { gap: Spacing.xs },
  toggleBtn: {
    flex: 1,
    minWidth: 80,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.wide,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgSurface,
  },
  compactToggleBtn: { paddingVertical: Spacing.sm, minWidth: 60 },
  toggleActive: {
    borderColor: Colors.gold,
    backgroundColor: Colors.goldMuted,
  },
  toggleText: { fontFamily: "Rajdhani_600SemiBold", fontSize: FontSize.sm, color: Colors.textSecondary },
  toggleTextActive: { color: Colors.gold },
  warn: { fontFamily: "Inter_400Regular", fontSize: FontSize.xs, color: Colors.dangerDim, marginBottom: Spacing.xs },
  sectionFlex: { flex: 1 },
  divider: { flexDirection: "row", alignItems: "center", gap: Spacing.cosy },
  divLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  divText: { fontFamily: "Inter_400Regular", fontSize: FontSize.xs, color: Colors.textMuted },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
  },
  modalScroll: { 
    flexGrow: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: Spacing.roomy 
  },
  modalBox: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    width: "100%",
    maxWidth: 400,
    gap: Spacing.md,
  },
  modalBoxLandscape: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  modalTitle: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.lg, color: Colors.text, textAlign: "center" },
  codeInput: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xxl,
    textAlign: "center",
    letterSpacing: 6,
    paddingVertical: Spacing.wide,
  },
  codeInputLandscape: {
    paddingVertical: Spacing.sm,
    fontSize: FontSize.xl,
  },
  modalRow: { flexDirection: "row", gap: Spacing.cosy },
  modalCancelBtn: {
    flex: 1,
    minHeight: TOUCH_TARGET_MIN,
    justifyContent: "center",
    paddingVertical: Spacing.cosy,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
  },
  modalCancelText: { fontFamily: "Rajdhani_600SemiBold", fontSize: FontSize.md, color: Colors.textMuted },
  modalOkBtn: {
    flex: 1,
    minHeight: TOUCH_TARGET_MIN,
    justifyContent: "center",
    paddingVertical: Spacing.cosy,
    borderRadius: Radius.sm,
    backgroundColor: Colors.gold,
    alignItems: "center",
  },
  modalOkText: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.md, color: Colors.bg },
});
