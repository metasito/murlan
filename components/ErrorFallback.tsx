import React, { useContext, useState } from "react";
import { reloadAppAsync } from "expo";
import {
  StyleSheet,
  View,
  Pressable,
  ScrollView,
  Text,
  Modal,
  Platform,
} from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Feather from "@expo/vector-icons/Feather";
import { Colors, Spacing, Radius, FontSize, Shadow } from "@/lib/theme";
import { MenuButton } from "@/components/MenuButton";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden } from "@/lib/a11y";

export type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
};

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

export function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  // Read the context directly rather than through useSafeAreaInsets(), which
  // throws when no provider is above. This is the last screen the app has; it
  // has to render even when the crash was in SafeAreaProvider itself.
  const insets = useContext(SafeAreaInsetsContext) ?? NO_INSETS;
  const { t } = useTranslation();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const handleRestart = async () => {
    setRestarting(true);
    try {
      await reloadAppAsync();
    } catch (restartError) {
      console.error("Failed to restart app:", restartError);
      setRestarting(false);
      resetError();
    }
  };

  const formatErrorDetails = (): string => {
    let details = t("errorFallback.errorLabel", { message: error.message });
    if (error.stack) {
      details += t("errorFallback.stackTraceLabel", { stack: error.stack });
    }
    return details;
  };

  const monoFont = Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  });

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.bg, Colors.bgCard]} style={StyleSheet.absoluteFill} />

      {__DEV__ ? (
        <Pressable
          onPress={() => setIsModalVisible(true)}
          accessibilityLabel={t("errorFallback.viewDetailsA11yLabel")}
          accessibilityRole="button"
          hitSlop={Spacing.xs}
          style={({ pressed }) => [
            styles.devButton,
            { top: insets.top + Spacing.md, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="alert-circle" size={20} color={Colors.gold} {...a11yHidden()} />
        </Pressable>
      ) : null}

      <View style={styles.content}>
        <View style={styles.iconBadge}>
          <Feather name="alert-triangle" size={40} color={Colors.gold} />
        </View>

        <Text style={styles.title}>{t("errorFallback.title")}</Text>

        <Text style={styles.message}>
          {t("errorFallback.message")}
        </Text>

        <View style={styles.actions}>
          <MenuButton
            label={restarting ? t("errorFallback.restarting") : t("errorFallback.restart")}
            onPress={handleRestart}
            variant="primary"
            loading={restarting}
            icon={!restarting ? <Feather name="refresh-cw" size={18} color={Colors.bg} /> : undefined}
            hint={t("errorFallback.restartA11yHint")}
          />
          <MenuButton
            label={t("errorFallback.continue")}
            onPress={resetError}
            variant="ghost"
            disabled={restarting}
            hint={t("errorFallback.continueA11yHint")}
          />
        </View>
      </View>

      {__DEV__ ? (
        <Modal
          visible={isModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setIsModalVisible(false)}
          // iOS defaults this to portrait only, which rotates the whole app when
          // the modal opens in landscape and leaves the screen behind it
          // mis-laid-out.
          supportedOrientations={["portrait", "landscape"]}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t("errorFallback.detailsTitle")}</Text>
                <Pressable
                  onPress={() => setIsModalVisible(false)}
                  accessibilityLabel={t("errorFallback.closeDetailsA11yLabel")}
                  accessibilityRole="button"
                  hitSlop={Spacing.xs}
                  style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Feather name="x" size={24} color={Colors.text} {...a11yHidden()} />
                </Pressable>
              </View>

              <ScrollView
                style={styles.modalScrollView}
                contentContainerStyle={[
                  styles.modalScrollContent,
                  { paddingBottom: insets.bottom + Spacing.md },
                ]}
                showsVerticalScrollIndicator
              >
                <View style={styles.errorContainer}>
                  <Text
                    style={[styles.errorText, { fontFamily: monoFont }]}
                    selectable
                  >
                    {formatErrorDetails()}
                  </Text>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    width: "100%",
    maxWidth: 420,
  },
  iconBadge: {
    width: 84,
    height: 84,
    borderRadius: Radius.full,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1.5,
    borderColor: Colors.goldMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
    ...Shadow.gold,
  },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xxl,
    color: Colors.gold,
    textAlign: "center",
    letterSpacing: 0.5,
  },
  message: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  actions: {
    width: "100%",
    marginTop: Spacing.md,
    gap: Spacing.xs,
  },
  devButton: {
    position: "absolute",
    right: Spacing.md,
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "flex-end",
  },
  modalContainer: {
    width: "100%",
    height: "90%",
    backgroundColor: Colors.bgCard,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderBottomWidth: 0,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xl,
    color: Colors.gold,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  modalScrollView: {
    flex: 1,
  },
  modalScrollContent: {
    padding: Spacing.md,
  },
  errorContainer: {
    width: "100%",
    borderRadius: Radius.sm,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    padding: Spacing.md,
  },
  errorText: {
    fontSize: FontSize.xs,
    lineHeight: 18,
    width: "100%",
    color: Colors.text,
  },
});
