import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Platform,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useRouter, usePathname } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { useSettings } from "@/context/SettingsContext";
import { useNotification } from "@/context/NotificationContext";
import { useAuth } from "@/context/AuthContext";
import NotificationBanner from "@/components/NotificationBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { Slider } from "@/components/Slider";
import { Toggle } from "@/components/Toggle";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { apiRequest, queryClient } from "@/lib/query-client";
import { hapticSelection } from "@/lib/haptics";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Colors, Spacing, Radius, FontSize, Type, Shadow, TOUCH_TARGET_MIN } from "@/lib/theme";
import { useTranslation, type Locale, type TranslationKey } from "@/lib/i18n";
import { registerForPush } from "@/lib/pushRegistration";
import type { MotionPreference } from "@/lib/accessibility";
import { a11yHidden, a11yState, useA11yHint } from "@/lib/a11y";
import Constants from "expo-constants";

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** Room for a couple of sentences without the send button leaving the screen. */
const BUG_INPUT_MIN_H = 96;

/** The row's label says what the setting is; the glyph repeats it in pictures. */
function RowIcon({ name }: { name: React.ComponentProps<typeof Feather>["name"] }) {
  return (
    <Feather
      name={name}
      size={FontSize.lg}
      color={Colors.textSecondary}
      style={styles.icon}
      {...a11yHidden()}
    />
  );
}

const MOTION_CHOICES: MotionPreference[] = ["system", "on", "off"];
const MOTION_LABELS: Record<MotionPreference, TranslationKey> = {
  system: "settings.motionSystem",
  on: "settings.motionReduced",
  off: "settings.motionFull",
};

interface Segment<T> {
  value: T;
  label: string;
}

/**
 * A row of mutually exclusive choices. Laid out full width under its own
 * label rather than beside it: the options are words, and words in three
 * languages do not fit in a chip sized for "IT".
 */
function Segmented<T extends string | number>({
  segments,
  selected,
  onSelect,
  a11yLabel,
  disabled = false,
}: {
  segments: Segment<T>[];
  selected: T;
  onSelect: (v: T) => void;
  a11yLabel: string;
  disabled?: boolean;
}) {
  return (
    <View
      style={[styles.segmentRow, disabled && styles.segmentRowDisabled]}
      accessibilityRole="radiogroup"
      accessibilityLabel={a11yLabel}
    >
      {segments.map((seg) => {
        const active = seg.value === selected;
        return (
          <Pressable
            key={String(seg.value)}
            onPress={() => {
              hapticSelection();
              onSelect(seg.value);
            }}
            disabled={disabled}
            accessibilityLabel={seg.label}
            {...a11yState({ role: "radio", selected: active, disabled })}
            style={({ pressed }) => [
              styles.segment,
              active && styles.segmentActive,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text
              {...a11yHidden()}
              numberOfLines={1}
              style={[styles.segmentText, active && styles.segmentTextActive]}
            >
              {seg.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SettingsModal({ visible, onClose }: Props) {
  const {
    soundVolume,
    musicVolume,
    hapticsEnabled,
    motion,
    setSoundVolume,
    setMusicVolume,
    setHapticsEnabled,
    setMotion,
  } = useSettings();
  const { logout } = useAuth();
  const { notification, showNotification, dismissNotification } = useNotification();
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const router = useRouter();
  const reduceMotion = usePrefersReducedMotion();
  const [deleting, setDeleting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const { t, locale, setLocale, locales, localeLabels } = useTranslation();
  // "0%" reads as a level, not as off.
  const volumeText = (v: number) =>
    v === 0 ? t("settings.muted") : t("settings.volumePercent", { percent: Math.round(v * 100) });
  const deleteHint = useA11yHint(t("settings.deleteAccountA11yHint"));
  const bugHint = useA11yHint(t("settings.reportBugA11yHint"));
  const [bugOpen, setBugOpen] = useState(false);
  const [bugText, setBugText] = useState("");
  const [sendingBug, setSendingBug] = useState(false);
  const pathname = usePathname();

  async function handleSendBugReport() {
    // Read before the try. The React Compiler cannot lower a value block —
    // optional chaining included — inside a try statement, and bails the whole
    // component out of memoization when it meets one.
    const appVersion = Constants.expoConfig?.version ?? undefined;
    setSendingBug(true);
    try {
      // The route it was reported from, the build and the locale — all of it
      // about the reporter, none of it about the table. Deliberately no game
      // state: that carries other players' names (#116).
      await apiRequest("POST", "/api/bug-reports", {
        description: bugText.trim(),
        screen: pathname,
        appVersion,
        platform: Platform.OS,
        locale,
      });
      setBugOpen(false);
      setBugText("");
      setSendingBug(false);
      showNotification({
        type: "game_info",
        title: t("settings.reportBugSentTitle"),
        message: t("settings.reportBugSentBody"),
      });
    } catch {
      // Cleared in both branches rather than in a `finally`: the React
      // Compiler cannot lower a try statement with one, and bails the whole
      // component out of memoization if it meets it (tests/reactCompiler).
      setSendingBug(false);
      showNotification({
        type: "game_error",
        title: t("settings.reportBugFailedTitle"),
        message: t("settings.reportBugFailedBody"),
      });
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      // Cleared after the session dies, not before: a query still in flight
      // would refetch against a live cookie and repopulate what was cleared.
      await logout();
      queryClient.clear();
      onClose();
      router.replace("/auth");
    } catch {
      // Cleared in both branches rather than in a `finally`: the React
      // Compiler cannot lower a try statement with one, and bails the whole
      // component out of memoization if it meets it (tests/reactCompiler).
      setLoggingOut(false);
      showNotification({
        type: "game_error",
        title: t("settings.logoutFailedTitle"),
        message: t("settings.logoutFailedBody"),
      });
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      // apiRequest throws on a non-ok response, so a failed deletion always
      // lands in the catch below instead of silently logging the user out.
      await apiRequest("DELETE", "/api/users/me");
      queryClient.clear();
      onClose();
      await logout();
      router.replace("/auth");
    } catch {
      setDeleting(false);
      showNotification({
        type: "game_error",
        title: t("settings.deleteFailedTitle"),
        message: t("settings.deleteFailedBody"),
      });
    }
  }

  function confirmLogout() {
    setConfirming({
      title: t("settings.logoutConfirmTitle"),
      body: t("settings.logoutConfirmBody"),
      cancelLabel: t("common.cancel"),
      confirmLabel: t("settings.logout"),
      onConfirm: handleLogout,
    });
  }

  function confirmDelete() {
    setConfirming({
      title: t("settings.deleteConfirmTitle"),
      body: t("settings.deleteConfirmBody"),
      cancelLabel: t("common.cancel"),
      confirmLabel: t("settings.deleteAccount"),
      destructive: true,
      onConfirm: handleDeleteAccount,
    });
  }

  function handleSelectLocale(next: Locale) {
    hapticSelection();
    void setLocale(next);
    // The server renders a push with no client in the loop, so this device's
    // language has to be re-registered here or the next invite arrives in the
    // old one. A no-op on every platform that cannot receive a push.
    void registerForPush();
  }

  function toggleHaptics(v: boolean) {
    // Fire on the current setting (before the flip) so the user feels the
    // effect they're about to turn off, or confirms the one they're enabling.
    hapticSelection();
    setHapticsEnabled(v);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
      statusBarTranslucent
      // iOS defaults this to portrait only, which rotates the whole app when the
      // modal opens in landscape and leaves the screen behind it mis-laid-out.
      supportedOrientations={["portrait", "landscape"]}
    >
      {/* A Modal renders in its own native window, outside the root view the
          gesture handler attaches to, so the volume sliders need their own. */}
      <GestureHandlerRootView style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          {...a11yHidden()}
        />
        <View style={styles.card} accessibilityViewIsModal accessibilityRole="none">
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              {t("settings.title")}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("settings.closeA11yLabel")}
              hitSlop={Spacing.xs}
              style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Feather name="x" size={FontSize.xl} color={Colors.text} {...a11yHidden()} />
            </Pressable>
          </View>

          <ScrollView testID="settings-scroll" style={styles.body} showsVerticalScrollIndicator>
            <View style={styles.stackRow}>
              <View style={styles.rowLeft}>
                <RowIcon name={soundVolume === 0 ? "volume-x" : "volume-2"} />
                <View style={styles.rowLabels}>
                  <Text style={styles.label}>{t("settings.sounds")}</Text>
                  <Text style={styles.sublabel}>{t("settings.soundsSubtitle")}</Text>
                </View>
              </View>
              <Slider
                value={soundVolume}
                onValueChange={setSoundVolume}
                a11yLabel={t("settings.volumeA11yLabel")}
                valueText={volumeText(soundVolume)}
              />
            </View>

            <View style={styles.stackRow}>
              <View style={styles.rowLeft}>
                <RowIcon name="music" />
                <View style={styles.rowLabels}>
                  <Text style={styles.label}>{t("settings.music")}</Text>
                  <Text style={styles.sublabel}>{t("settings.musicSubtitle")}</Text>
                </View>
              </View>
              <Slider
                value={musicVolume}
                onValueChange={setMusicVolume}
                a11yLabel={t("settings.musicVolumeA11yLabel")}
                valueText={volumeText(musicVolume)}
              />
            </View>

            {Platform.OS !== "web" && (
              <View style={styles.row}>
                <View style={styles.rowLeft}>
                  <RowIcon name="smartphone" />
                  <View>
                    <Text style={styles.label}>{t("settings.haptics")}</Text>
                    <Text style={styles.sublabel}>{t("settings.hapticsSubtitle")}</Text>
                  </View>
                </View>
                <Toggle
                  value={hapticsEnabled}
                  onValueChange={toggleHaptics}
                  a11yLabel={t("settings.hapticsA11yLabel")}
                  a11yHint={t("settings.hapticsA11yHint")}
                />
              </View>
            )}

            <View style={styles.stackRow}>
              <View style={styles.rowLeft}>
                <RowIcon name="film" />
                <View style={styles.rowLabels}>
                  <Text style={styles.label}>{t("settings.motion")}</Text>
                  <Text style={styles.sublabel}>{t("settings.motionSubtitle")}</Text>
                </View>
              </View>
              <Segmented
                segments={MOTION_CHOICES.map((v) => ({ value: v, label: t(MOTION_LABELS[v]) }))}
                selected={motion}
                onSelect={setMotion}
                a11yLabel={t("settings.motionA11yLabel")}
              />
            </View>

            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <RowIcon name="globe" />
                <View>
                  <Text style={styles.label}>{t("settings.language")}</Text>
                  <Text style={styles.sublabel}>{t("settings.languageSubtitle")}</Text>
                </View>
              </View>
              <View style={styles.localeGroup}>
                {locales.map((code) => {
                  const active = code === locale;
                  return (
                    <Pressable
                      key={code}
                      onPress={() => handleSelectLocale(code)}
                      accessibilityLabel={localeLabels[code]}
                      {...a11yState({ role: "button", selected: active })}
                      style={({ pressed }) => [
                        styles.localeBtn,
                        active && styles.localeBtnActive,
                        pressed && { opacity: 0.8 },
                      ]}
                    >
                      <Text {...a11yHidden()} style={[styles.localeBtnText, active && styles.localeBtnTextActive]}>
                        {code.toUpperCase()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.divider} />

            {/* Opened in place rather than in a Modal of its own: this screen
                is already a Modal, and a second one over it is unreliable on
                iOS. One tap either way. */}
            <Pressable
              onPress={() => {
                hapticSelection();
                setBugOpen((open) => !open);
              }}
              accessibilityLabel={t("settings.reportBug")}
              {...bugHint.props}
              {...a11yState({ role: "button", expanded: bugOpen })}
              style={({ pressed }) => [styles.bugBtn, pressed && { opacity: 0.8 }]}
            >
              {bugHint.node}
              <Feather name="alert-circle" size={16} color={Colors.gold} {...a11yHidden()} />
              <Text style={styles.bugBtnText} {...a11yHidden()}>{t("settings.reportBug")}</Text>
            </Pressable>

            {bugOpen && (
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={styles.bugForm}
              >
                <Text style={styles.bugHint}>{t("settings.reportBugPrompt")}</Text>
                <TextInput
                  value={bugText}
                  onChangeText={setBugText}
                  multiline
                  editable={!sendingBug}
                  placeholder={t("settings.reportBugPlaceholder")}
                  placeholderTextColor={Colors.textMuted}
                  accessibilityLabel={t("settings.reportBugFieldA11yLabel")}
                  style={styles.bugInput}
                />
                <Pressable
                  onPress={handleSendBugReport}
                  disabled={sendingBug || bugText.trim().length === 0}
                  accessibilityLabel={t("settings.reportBugSend")}
                  {...a11yState({
                    role: "button",
                    disabled: sendingBug || bugText.trim().length === 0,
                    busy: sendingBug,
                  })}
                  style={({ pressed }) => [
                    styles.bugSend,
                    (sendingBug || bugText.trim().length === 0) && styles.bugSendDisabled,
                    pressed && !sendingBug && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.bugSendText} {...a11yHidden()}>
                    {sendingBug ? t("settings.reportBugSending") : t("settings.reportBugSend")}
                  </Text>
                </Pressable>
              </KeyboardAvoidingView>
            )}

            <View style={styles.divider} />

            <Pressable
              onPress={confirmLogout}
              disabled={loggingOut}
              accessibilityLabel={t("settings.logoutA11yLabel")}
              {...a11yState({ role: "button", disabled: loggingOut, busy: loggingOut })}
              style={({ pressed }) => [
                styles.accountBtn,
                pressed && !loggingOut && styles.logoutPressed,
                loggingOut && styles.accountBtnDisabled,
              ]}
            >
              <Text style={styles.logoutLabel} {...a11yHidden()}>
                {t("settings.logout")}
              </Text>
            </Pressable>

            <Pressable
              onPress={confirmDelete}
              disabled={deleting}
              accessibilityLabel={t("settings.deleteAccount")}
              {...deleteHint.props}
              {...a11yState({ role: "button", disabled: deleting, busy: deleting })}
              style={({ pressed }) => [
                styles.accountBtn,
                pressed && !deleting && styles.deletePressed,
                deleting && styles.accountBtnDisabled,
              ]}
            >
              {deleteHint.node}
              <Text style={styles.deleteLabel} {...a11yHidden()}>
                {deleting ? t("settings.deleting") : t("settings.deleteAccount")}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
        {/* A Modal is its own stacking context, so the root banners cannot
            paint over it. */}
        <NotificationBanner notification={notification} onDismiss={dismissNotification} />
        <ConfirmDialog request={confirming} onClose={() => setConfirming(null)} />
        <OfflineBanner />
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    maxHeight: "90%",
    ...Shadow.overlay,
  },
  body: {
    flexShrink: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  title: {
    ...Type.heading,
    color: Colors.gold,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  closeBtn: {
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: TOUCH_TARGET_MIN,
    paddingVertical: Spacing.slim,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  icon: { width: 24, textAlign: "center" },
  label: { ...Type.bodyStrong, color: Colors.text },
  sublabel: { ...Type.caption },
  stackRow: { gap: Spacing.slim, paddingVertical: Spacing.slim },
  rowLabels: { flexShrink: 1 },
  segmentRow: { flexDirection: "row", gap: Spacing.xs },
  segmentRowDisabled: { opacity: 0.4 },
  segment: {
    flex: 1,
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segmentActive: { borderColor: Colors.gold, backgroundColor: Colors.goldMuted },
  segmentText: { ...Type.caption, color: Colors.textMuted },
  segmentTextActive: { color: Colors.gold, fontFamily: Type.bodyStrong.fontFamily },
  localeGroup: { flexDirection: "row", gap: Spacing.xs },
  localeBtn: {
    minWidth: TOUCH_TARGET_MIN,
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  localeBtnActive: { borderColor: Colors.gold, backgroundColor: Colors.goldMuted },
  localeBtnText: { ...Type.caption, color: Colors.textMuted },
  localeBtnTextActive: { color: Colors.gold, fontFamily: Type.bodyStrong.fontFamily },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  bugBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: TOUCH_TARGET_MIN,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
  },
  bugBtnText: { ...Type.body, fontSize: FontSize.md, color: Colors.text },
  bugForm: { gap: Spacing.sm, marginTop: Spacing.sm },
  bugHint: { ...Type.body, fontSize: FontSize.sm, color: Colors.textMuted },
  bugInput: {
    ...Type.body,
    fontSize: FontSize.md,
    color: Colors.text,
    minHeight: BUG_INPUT_MIN_H,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
    textAlignVertical: "top",
  },
  bugSend: {
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.md,
    backgroundColor: Colors.goldMuted,
  },
  bugSendDisabled: { opacity: 0.5 },
  bugSendText: { ...Type.body, fontSize: FontSize.md, color: Colors.goldLit },
  accountBtn: {
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.sm,
    paddingVertical: Spacing.sm,
  },
  accountBtnDisabled: { opacity: 0.5 },
  logoutPressed: { backgroundColor: Colors.goldGhost },
  // Leaving is reversible and deleting is not, so only one of the two is
  // allowed to read as an alarm.
  logoutLabel: { ...Type.body, color: Colors.text, textAlign: "center" },
  deletePressed: { backgroundColor: Colors.dangerDim + "1A" },
  deleteLabel: { ...Type.body, color: Colors.dangerDim, textAlign: "center" },
});
