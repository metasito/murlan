import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  ActivityIndicator,
} from "react-native";
import { useIsLandscape } from "@/lib/device/orientation";
import { uiFeedback } from "@/lib/device/feedback";
import { ScreenHeader } from "@/components/ScreenHeader";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  useOnlineConnection,
  useOnlineRoom,
  useServerError,
} from "@/context/onlineGameHooks";
import { useAuth } from "@/context/AuthContext";
import { useInvites } from "@/context/SocketContext";
import { Colors, Spacing, FontSize, Radius, TOUCH_TARGET_MIN, Type } from '@/lib/theme';
import { keyboardBehavior } from "@/lib/device/keyboard";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { ModePicker, SeatCountPicker } from "@/components/lobbyPickers";
import type { GameMode } from "@/lib/game/gameEngine";
import { useTranslation } from "@/lib/i18n";
import { A11yStatus, a11yHidden, a11yState, useA11yHint } from "@/lib/a11y";
import { AppModal } from "@/components/AppModal";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { joinCode as roomCodeOf } from "@/lib/deepLink";

export default function OnlineLobbyScreen() {
  const { t } = useTranslation();
  const roomCodeHint = useA11yHint(t("onlineLobby.roomCodeA11yHint"));
  const watchHint = useA11yHint(t("onlineLobby.watchA11yHint"));
  const { user } = useAuth();
  const { createRoom, joinRoom, spectateRoom, room } = useOnlineRoom();
  const { connected, clearError } = useOnlineConnection();
  const error = useServerError("lobby");
  const { prompt: pendingInvite, clearPrompt: clearInvite, accepted: acceptedInvite } = useInvites();
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [joiningInvite, setJoiningInvite] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const canJoin = roomCodeOf(joinCode) !== null;
  const [createMode, setCreateMode] = useState<GameMode>("free_for_all");
  const [createPlayers, setCreatePlayers] = useState(4);

  const isLandscape = useIsLandscape();

  const roomId = room?.roomId;

  // A tap on home's invite card is the player already saying yes, so asking
  // again with the code prefilled is a step that answers nothing. The join
  // itself waits for the socket in `context/useOnlineRouting.ts`; this says so
  // meanwhile, so the wait is not a dead screen.
  // Seeded empty, not with the current value: both of these arrive as context
  // from another screen, so they are usually already set on the first render
  // here — which is the render that has to act on them.
  const [answeredInvite, setAnsweredInvite] = useState<typeof acceptedInvite>(null);
  if (acceptedInvite !== answeredInvite) {
    setAnsweredInvite(acceptedInvite);
    if (acceptedInvite) setJoiningInvite(true);
  }

  // Either way the join is over. Success pushes the room *on top of* this
  // screen rather than replacing it, so back would come home to a banner still
  // claiming a join is in flight.
  const joinSettled = Boolean(error || roomId);
  const [shownSettled, setShownSettled] = useState(false);
  if (joinSettled !== shownSettled) {
    setShownSettled(joinSettled);
    if (joinSettled) setJoiningInvite(false);
  }

  // An invite that merely arrived, on the other hand, has not been answered:
  // it prefills the code and asks.
  const [promptedFor, setPromptedFor] = useState<typeof pendingInvite>(null);
  if (pendingInvite !== promptedFor) {
    setPromptedFor(pendingInvite);
    if (pendingInvite) {
      setJoinCode(pendingInvite.roomCode);
      setJoinModalVisible(true);
    }
  }

  // The invite belongs to SocketContext, so retiring it is that provider's
  // state and cannot be touched from this one's render.
  useEffect(() => {
    if (pendingInvite) clearInvite();
  }, [pendingInvite, clearInvite]);

  function handleCreate() {
    uiFeedback("medium");
    createRoom(createMode, createPlayers);
  }

  function closeJoin() {
    setJoinModalVisible(false);
    setJoinCode("");
  }

  function handleJoin() {
    if (!canJoin) return;
    uiFeedback("medium");
    joinRoom(joinCode);
    closeJoin();
  }

  function handleSpectate() {
    if (!canJoin) return;
    uiFeedback("medium");
    spectateRoom(joinCode);
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
          <ModePicker value={createMode} onChange={setCreateMode} seats={createPlayers} form="short" compact={isLandscape} />
        </View>

        <View style={isLandscape ? styles.optSectionLandscape : styles.optSection}>
          <Text style={styles.optLabelSmall}>{t("onlineLobby.playersLabel")}</Text>
          <SeatCountPicker value={createPlayers} onChange={setCreatePlayers} mode={createMode} compact={isLandscape} />
        </View>

        <View style={{ marginTop: isLandscape ? Spacing.xs : Spacing.sm }}>
          <MenuButton
            label={t("onlineLobby.createRoom")}
            onPress={handleCreate}
            variant="primary"
            fullWidth={true}
            style={isLandscape ? { minHeight: TOUCH_TARGET_MIN } : undefined}
            icon={<Ionicons name="add-circle-outline" size={20} color={Colors.bg} />}
          />
        </View>
      </MenuCard>
    </View>
  );

  const JoinSection = (
    <View style={sectionFlex}>
      <MenuCard title={t("onlineLobby.joinRoomTitle")} style={isLandscape ? styles.compactCard : undefined}>
        <View style={{ paddingVertical: isLandscape ? Spacing.xxs : Spacing.xs }}>
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
    <MenuLayout scrollable={false} centered={false} avoidsKeyboard={false} style={{ paddingBottom: 0 }}>
      <ScreenHeader title={t("onlineLobby.title")} />

      {/* Same slot as the error, and mutually exclusive with it: the join either
          is still happening or has failed. Without this the player taps Join on
          home, arrives here, and watches an unchanged lobby while the socket
          connects. */}
      {joiningInvite && !error && (
        <View style={styles.joiningBanner}>
          <A11yStatus label={t("onlineLobby.joiningInvite")} role="alert" live="polite" />
          <ActivityIndicator size="small" color={Colors.gold} {...a11yHidden()} />
          <Text style={styles.joiningBannerText} numberOfLines={1} {...a11yHidden()}>
            {t("onlineLobby.joiningInvite")}
          </Text>
        </View>
      )}

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
            {error.text}
          </Text>
          {/* A floor-sized box laid out at the icon's size: a box taking its own room
              would take the banner from 32pt to 60 on a single-line message. */}
          <Pressable
            onPress={() => clearError(error.seq)}
            style={styles.errorBannerClose}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <Ionicons
              name="close"
              size={CLOSE_ICON}
              color={Colors.white}
              {...a11yHidden()}
            />
          </Pressable>
        </View>
      )}

      {isLandscape ? (
        // The block is a fixed height a short window cannot always hold — an
        // iPhone SE in landscape is 320pt against ~330 of content, and Crea
        // Stanza is what falls off the end (#621). The scroller is the same one
        // the portrait branch below already owns, and it has to live here
        // rather than in `MenuLayout`: a ScrollView measures its content
        // unbounded on *both* engines — react-native-web gives its content
        // container `flex-shrink: 0`, and Yoga leaves the child of an
        // `Overflow::Scroll` node undefined and so never resolves a shrink
        // (`CalculateLayout.cpp` `:166`, `:655`) — so a layout-wide fallback
        // would let room.tsx's and lobby.tsx's own inner scrollers grow to
        // their content and carry their pinned footers off the bottom.
        <ScrollView
          contentContainerStyle={[styles.body, styles.bodyLandscape]}
          // The indicator stays, unlike every other menu scroller here: this is
          // a `MenuLayout scrollable={false}` screen, so `menu-more-below`'s
          // fade never applies to it, and without either cue the only sign that
          // Crea Stanza exists below the fold is a half-cut radio. #587 is the
          // same finding — a screen that ends flush reads as finished.
          keyboardShouldPersistTaps="handled"
        >
          {/* Two shrinkable spacers rather than `justifyContent: "center"`:
              centring a block taller than its box pushes the top of it off the
              screen, and the shortest phone in landscape is exactly that case. */}
          <View style={styles.slack} />
          <View style={styles.contentWrapperLandscape}>
            <ConnectionStatus connected={connected} username={user?.username ?? ""} style={styles.status} />

            <View style={styles.landscapeRow}>
              {CreateSection}
              <View style={styles.dividerV} />
              {JoinSection}
            </View>
          </View>
          <View style={styles.slack} />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.body, styles.bodyPortrait, { paddingBottom: Spacing.lg }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.contentWrapper}>
            <ConnectionStatus connected={connected} username={user?.username ?? ""} style={styles.status} />

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

      <AppModal
        visible={joinModalVisible}
        onRequestClose={closeJoin}
        accessibilityLabel={t("onlineLobby.joinModalTitle")}
      >
        <KeyboardAvoidingView
          behavior={keyboardBehavior({ contentAdjustsInsets: false })}
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
                  <Text style={styles.modalCancelText} {...a11yHidden()}>{t("common.cancel")}</Text>
                </Pressable>
                <Pressable
                  onPress={handleSpectate}
                  disabled={!canJoin}
                  style={({ pressed }) => [
                    styles.modalCancelBtn,
                    !canJoin && styles.modalBtnDisabled,
                    pressed && { opacity: PRESSED_OPACITY },
                  ]}
                  accessibilityLabel={t("onlineLobby.watch")}
                  {...watchHint.props}
                  {...a11yState({ role: "button", disabled: !canJoin })}
                >
                  {watchHint.node}
                  <Text style={styles.modalCancelText} {...a11yHidden()}>{t("onlineLobby.watch")}</Text>
                </Pressable>
                <Pressable
                  onPress={handleJoin}
                  disabled={!canJoin}
                  style={({ pressed }) => [
                    styles.modalOkBtn,
                    !canJoin && styles.modalBtnDisabled,
                    pressed && { opacity: PRESSED_OPACITY },
                  ]}
                  accessibilityLabel={t("onlineLobby.enter")}
                  {...a11yState({ role: "button", disabled: !canJoin })}
                >
                  <Text style={styles.modalOkText} {...a11yHidden()}>{t("onlineLobby.enter")}</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </AppModal>
    </MenuLayout>
  );
}

const PRESSED_OPACITY = 0.85;
const DISABLED_OPACITY = 0.4;
const CLOSE_ICON = 16;

const styles = StyleSheet.create({
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
  errorBannerClose: {
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
    margin: -(TOUCH_TARGET_MIN - CLOSE_ICON) / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  joiningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.goldGhost,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  joiningBannerText: {
    ...Type.body,
    color: Colors.gold,
    flex: 1,
  },
  errorBannerText: {
    ...Type.body,
    color: Colors.white,
    flex: 1,
  },
  body: { gap: Spacing.lg },
  // Safe here where it is not in the landscape body: this is a ScrollView's
  // content container, so when the content is taller there is no free space
  // for `center` to distribute and nothing moves off the top.
  bodyPortrait: { flexGrow: 1, justifyContent: "center" },
  // No gap: the two spacers are the composition, and a gap between them and
  // the block is height taken off a body that cannot scroll.
  // `flexGrow`, not `flex: 1`: this is a scroll container's content, and a zero
  // basis would hold it at the window's height — which is the clipping this
  // scroller exists to end. Growing keeps the two spacers' centring on any
  // window tall enough to have slack to give them.
  bodyLandscape: { gap: 0, flexGrow: 1 },
  contentWrapper: {
    gap: Spacing.md,
  },
  // A radio group and a single button have one right height, so the answer to a
  // tall window is where the pair sits in it, not how far the cards stretch.
  // The two columns keep a common top — centring them one by one puts their
  // section labels at different heights, which reads as a mistake.
  contentWrapperLandscape: {
    gap: Spacing.sm,
  },
  slack: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  landscapeRow: { flexDirection: "row", gap: Spacing.roomy, alignItems: "flex-start" },
  dividerV: { width: 1, backgroundColor: Colors.border, alignSelf: "stretch", marginHorizontal: Spacing.snug },
  status: { marginBottom: Spacing.xs },
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
  modalBtnDisabled: { opacity: DISABLED_OPACITY },
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
