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
import { Feather } from "@expo/vector-icons";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { apiRequest, queryClient } from "@/lib/query-client";
import { hapticSelection } from "@/lib/haptics";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Colors, Spacing, Radius, FontSize, Type, Shadow } from "@/lib/theme";
import { useTranslation, type Locale } from "@/lib/i18n";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function SettingsModal({ visible, onClose }: Props) {
  const { soundsEnabled, hapticsEnabled, setSoundsEnabled, setHapticsEnabled } =
    useSettings();
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
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
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
              accessibilityHint={t("settings.soundsA11yHint")}
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
                accessibilityHint={t("settings.hapticsA11yHint")}
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
                    accessibilityRole="button"
                    accessibilityLabel={localeLabels[code]}
                    accessibilityState={{ selected: active }}
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
            accessibilityRole="button"
            accessibilityLabel={t("settings.deleteAccount")}
            accessibilityHint={t("settings.deleteAccountA11yHint")}
            accessibilityState={{ disabled: deleting, busy: deleting }}
            style={({ pressed }) => [
              styles.deleteBtn,
              pressed && !deleting && styles.deleteBtnPressed,
              deleting && styles.deleteBtnDisabled,
            ]}
          >
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
  localeGroup: { flexDirection: "row", gap: Spacing.xs },
  localeBtn: {
    minWidth: 40,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  localeBtnActive: { borderColor: Colors.gold, backgroundColor: Colors.gold + "26" },
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
  deleteBtnText: { ...Type.body, color: Colors.danger, textAlign: "center" },
});
