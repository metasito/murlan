import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  Switch,
  Pressable,
  StyleSheet,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { LinearGradient } from "expo-linear-gradient";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
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
import type { MotionPreference } from "@/lib/accessibility";
import { A11yHintText, a11yHidden, a11yHint, a11yState } from "@/lib/a11y";

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
    hapticsEnabled,
    motion,
    cardBack,
    tableFelt,
    setSoundsEnabled,
    setSoundVolume,
    setHapticsEnabled,
    setMotion,
    setCardBack,
    setTableFelt,
  } = useSettings();
  const { logout } = useAuth();
  const router = useRouter();
  const reduceMotion = usePrefersReducedMotion();
  const [deleting, setDeleting] = useState(false);
  const { t, locale, setLocale, locales, localeLabels } = useTranslation();

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
      Alert.alert(t("settings.deleteFailedTitle"), t("settings.deleteFailedBody"));
    }
  }

  function confirmDelete() {
    Alert.alert(
      t("settings.deleteConfirmTitle"),
      t("settings.deleteConfirmBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("settings.deleteAccount"), style: "destructive", onPress: handleDeleteAccount },
      ]
    );
  }

  function handleSelectLocale(next: Locale) {
    hapticSelection();
    void setLocale(next);
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

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.icon}>🔊</Text>
              <View>
                <Text style={styles.label}>{t("settings.sounds")}</Text>
                <Text style={styles.sublabel}>{t("settings.soundsSubtitle")}</Text>
              </View>
            </View>
            <Switch
              value={soundsEnabled}
              onValueChange={setSoundsEnabled}
              trackColor={{ false: Colors.bgElevated, true: Colors.gold }}
              thumbColor={soundsEnabled ? Colors.white : Colors.textMuted}
              accessibilityRole="switch"
              accessibilityLabel={t("settings.soundsA11yLabel")}
              {...a11yHint(t("settings.soundsA11yHint"))}
            />
            <A11yHintText hint={t("settings.soundsA11yHint")} />
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
              <Switch
                value={hapticsEnabled}
                onValueChange={toggleHaptics}
                trackColor={{ false: Colors.bgElevated, true: Colors.gold }}
                thumbColor={hapticsEnabled ? Colors.white : Colors.textMuted}
                accessibilityRole="switch"
                accessibilityLabel={t("settings.hapticsA11yLabel")}
                {...a11yHint(t("settings.hapticsA11yHint"))}
              />
              <A11yHintText hint={t("settings.hapticsA11yHint")} />
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

          <Pressable
            onPress={confirmDelete}
            disabled={deleting}
            accessibilityLabel={t("settings.deleteAccount")}
            {...a11yHint(t("settings.deleteAccountA11yHint"))}
            {...a11yState({ role: "button", disabled: deleting, busy: deleting })}
            style={({ pressed }) => [
              styles.deleteBtn,
              pressed && !deleting && styles.deleteBtnPressed,
              deleting && styles.deleteBtnDisabled,
            ]}
          >
            <A11yHintText hint={t("settings.deleteAccountA11yHint")} />
            <Text style={styles.deleteBtnText}>
              {deleting ? t("settings.deleting") : t("settings.deleteAccount")}
            </Text>
          </Pressable>
        </View>
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
    ...Shadow.overlay,
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
    marginBottom: 2,
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
