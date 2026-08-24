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
import { useRouter, usePathname } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { LinearGradient } from "expo-linear-gradient";
import { useSettings } from "@/context/SettingsContext";
import { useNotification } from "@/context/NotificationContext";
import { useAuth } from "@/context/AuthContext";
import NotificationBanner from "@/components/NotificationBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { Toggle } from "@/components/Toggle";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { apiRequest, queryClient } from "@/lib/query-client";
import { hapticSelection } from "@/lib/haptics";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import {
  CARD_BACK_IDS,
  TABLE_FELT_IDS,
  cardBackField,
  cardBackNameKey,
  getTableFelt,
  tableFeltNameKey,
} from "@/lib/cosmetics";
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

// Presets rather than a continuous slider: no slider ships with the app, and
// three named steps are easier to hit on a phone than a 4pt-tall track.
const VOLUME_LEVELS = [0.35, 0.65, 1] as const;
const VOLUME_LABELS: Record<number, TranslationKey> = {
  0.35: "settings.volumeLow",
  0.65: "settings.volumeMedium",
  1: "settings.volumeHigh",
};

/** A stored volume from another build need not be one of the presets. */
function nearestVolume(v: number): number {
  return VOLUME_LEVELS.reduce((best, level) =>
    Math.abs(level - v) < Math.abs(best - v) ? level : best
  );
}

/** Room for a couple of sentences without the send button leaving the screen. */
const BUG_INPUT_MIN_H = 96;

const MOTION_CHOICES: MotionPreference[] = ["system", "on", "off"];
const MOTION_LABELS: Record<MotionPreference, TranslationKey> = {
  system: "settings.motionSystem",
  on: "settings.motionReduced",
  off: "settings.motionFull",
};

interface Segment<T> {
  value: T;
  label: string;
  /** Colour chip above the label — for choices that *are* a colour. */
  swatch?: readonly [string, string];
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
            {seg.swatch && (
              <LinearGradient
                colors={seg.swatch}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.swatch}
              />
            )}
            <Text
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
    soundsEnabled,
    soundVolume,
    musicEnabled,
    musicVolume,
    hapticsEnabled,
    motion,
    cardBack,
    tableFelt,
    setSoundsEnabled,
    setSoundVolume,
    setMusicEnabled,
    setMusicVolume,
    setHapticsEnabled,
    setMotion,
    setCardBack,
    setTableFelt,
  } = useSettings();
  const { logout } = useAuth();
  const { notification, showNotification, dismissNotification } = useNotification();
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const router = useRouter();
  const reduceMotion = usePrefersReducedMotion();
  const [deleting, setDeleting] = useState(false);
  const { t, locale, setLocale, locales, localeLabels } = useTranslation();
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
      <View style={styles.backdrop}>
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
              <Feather name="x" size={FontSize.xl} color={Colors.text} />
            </Pressable>
          </View>

          <ScrollView testID="settings-scroll" style={styles.body} showsVerticalScrollIndicator>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.icon}>🔊</Text>
                <View>
                  <Text style={styles.label}>{t("settings.sounds")}</Text>
                  <Text style={styles.sublabel}>{t("settings.soundsSubtitle")}</Text>
                </View>
              </View>
              <Toggle
                value={soundsEnabled}
                onValueChange={setSoundsEnabled}
                a11yLabel={t("settings.soundsA11yLabel")}
                a11yHint={t("settings.soundsA11yHint")}
              />
            </View>

            <View style={styles.stackRow}>
              <View style={styles.rowLeft}>
                <Text style={styles.icon}>🔉</Text>
                <View style={styles.rowLabels}>
                  <Text style={styles.label}>{t("settings.volume")}</Text>
                  <Text style={styles.sublabel}>{t("settings.volumeSubtitle")}</Text>
                </View>
              </View>
              <Segmented
                segments={VOLUME_LEVELS.map((v) => ({ value: v, label: t(VOLUME_LABELS[v]) }))}
                selected={nearestVolume(soundVolume)}
                onSelect={setSoundVolume}
                a11yLabel={t("settings.volumeA11yLabel")}
                disabled={!soundsEnabled}
              />
            </View>

            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.icon}>🎵</Text>
                <View>
                  <Text style={styles.label}>{t("settings.music")}</Text>
                  <Text style={styles.sublabel}>{t("settings.musicSubtitle")}</Text>
                </View>
              </View>
              <Toggle
                value={musicEnabled}
                onValueChange={setMusicEnabled}
                a11yLabel={t("settings.musicA11yLabel")}
                a11yHint={t("settings.musicA11yHint")}
              />
            </View>

            <View style={styles.stackRow}>
              <View style={styles.rowLeft}>
                <Text style={styles.icon}>🎚️</Text>
                <View style={styles.rowLabels}>
                  <Text style={styles.label}>{t("settings.musicVolume")}</Text>
                  <Text style={styles.sublabel}>{t("settings.musicVolumeSubtitle")}</Text>
                </View>
              </View>
              <Segmented
                segments={VOLUME_LEVELS.map((v) => ({ value: v, label: t(VOLUME_LABELS[v]) }))}
                selected={nearestVolume(musicVolume)}
                onSelect={setMusicVolume}
                a11yLabel={t("settings.musicVolumeA11yLabel")}
                disabled={!musicEnabled}
              />
            </View>

            <View style={styles.stackRow}>
              <View style={styles.rowLeft}>
                <Text style={styles.icon}>🎬</Text>
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

            <View style={styles.stackRow}>
              <View style={styles.rowLeft}>
                <Text style={styles.icon}>🃏</Text>
                <View style={styles.rowLabels}>
                  <Text style={styles.label}>{t("settings.cardBack")}</Text>
                  <Text style={styles.sublabel}>{t("settings.cardBackSubtitle")}</Text>
                </View>
              </View>
              <Segmented
                segments={CARD_BACK_IDS.map((id) => ({
                  value: id,
                  label: t(cardBackNameKey(id)),
                  swatch: [cardBackField(id)[1], cardBackField(id)[4]] as const,
                }))}
                selected={cardBack}
                onSelect={setCardBack}
                a11yLabel={t("settings.cardBackA11yLabel")}
              />
            </View>

            <View style={styles.stackRow}>
              <View style={styles.rowLeft}>
                <Text style={styles.icon}>🎴</Text>
                <View style={styles.rowLabels}>
                  <Text style={styles.label}>{t("settings.tableFelt")}</Text>
                  <Text style={styles.sublabel}>{t("settings.tableFeltSubtitle")}</Text>
                </View>
              </View>
              <Segmented
                segments={TABLE_FELT_IDS.map((id) => ({
                  value: id,
                  label: t(tableFeltNameKey(id)),
                  swatch: [getTableFelt(id)[0], getTableFelt(id)[4]] as const,
                }))}
                selected={tableFelt}
                onSelect={setTableFelt}
                a11yLabel={t("settings.tableFeltA11yLabel")}
              />
            </View>

            {Platform.OS !== "web" && (
              <View style={styles.row}>
                <View style={styles.rowLeft}>
                  <Text style={styles.icon}>📳</Text>
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

            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.icon}>🌐</Text>
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
                      <Text style={[styles.localeBtnText, active && styles.localeBtnTextActive]}>
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
              <Feather name="alert-circle" size={16} color={Colors.gold} {...a11yHidden} />
              <Text style={styles.bugBtnText}>{t("settings.reportBug")}</Text>
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
                  <Text style={styles.bugSendText}>
                    {sendingBug ? t("settings.reportBugSending") : t("settings.reportBugSend")}
                  </Text>
                </Pressable>
              </KeyboardAvoidingView>
            )}

            <View style={styles.divider} />

            <Pressable
              onPress={confirmDelete}
              disabled={deleting}
              accessibilityLabel={t("settings.deleteAccount")}
              {...deleteHint.props}
              {...a11yState({ role: "button", disabled: deleting, busy: deleting })}
              style={({ pressed }) => [
                styles.deleteBtn,
                pressed && !deleting && styles.deleteBtnPressed,
                deleting && styles.deleteBtnDisabled,
              ]}
            >
              {deleteHint.node}
              <Text style={styles.deleteBtnText}>
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
      </View>
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
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  icon: { fontSize: FontSize.xl, width: 32, textAlign: "center" },
  label: { ...Type.bodyStrong, fontSize: FontSize.md, color: Colors.text },
  sublabel: { ...Type.caption },
  stackRow: { gap: Spacing.sm, paddingVertical: Spacing.sm },
  rowLabels: { flexShrink: 1 },
  segmentRow: { flexDirection: "row", gap: Spacing.xs },
  segmentRowDisabled: { opacity: 0.4 },
  swatch: {
    width: 22,
    height: 14,
    borderRadius: Radius.sm / 2,
    marginBottom: Spacing.xxs,
  },
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
  deleteBtn: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.sm,
    paddingVertical: Spacing.sm,
  },
  deleteBtnPressed: { backgroundColor: Colors.dangerDim + "1A" },
  deleteBtnDisabled: { opacity: 0.5 },
  deleteBtnText: { ...Type.body, color: Colors.dangerDim, textAlign: "center" },
});
