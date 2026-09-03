import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ScreenHeader } from "@/components/ScreenHeader";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/query-client";
import { serverErrorMessage } from "@/lib/apiError";
import { Colors, FontSize, Radius, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";

/**
 * Reachable signed-in or signed-out: the redeem route is public (the token
 * is the credential — server/authTokens.ts), and a player who read the mail
 * on another device may land here with no session on this one at all.
 * `refreshUser()` then has nothing to confirm and leaves `user` as it was.
 */
export default function VerifyEmailScreen() {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const token = code.trim();
    if (!token) {
      setError(t("verifyEmail.missingCode"));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/verify-email", { token });
      await refreshUser();
      router.back();
    } catch (e: unknown) {
      setError(serverErrorMessage(e, t("verifyEmail.failed")));
    }
    setLoading(false);
  }

  return (
    <MenuLayout scrollable centered={false}>
      <ScreenHeader title={t("verifyEmail.title")} />

      <View style={styles.contentWrapper}>
        <MenuCard padding="sm">
          <View style={styles.form}>
            <Text style={styles.body}>{t("verifyEmail.body")}</Text>

            <View style={styles.field}>
              <Text style={styles.label}>{t("verifyEmail.codeLabel")}</Text>
              <View style={styles.inputRow}>
                <Ionicons name="key-outline" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={code}
                  onChangeText={(v) => { setCode(v); setError(null); }}
                  placeholder={t("verifyEmail.codePlaceholder")}
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={submit}
                  accessibilityLabel={t("verifyEmail.codeA11yLabel")}
                  testID="input-verify-email-code"
                />
              </View>
            </View>

            {/* A live region announces the text that changes inside it, so it
                is never `accessible`: that would make it a leaf with no label
                of its own to speak. */}
            {error && (
              <View style={styles.errorBox} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle-outline" size={14} color={Colors.dangerDim} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <MenuButton
              label={loading ? t("verifyEmail.saving") : t("verifyEmail.submit")}
              onPress={submit}
              variant="primary"
              loading={loading}
              accessibilityLabel={t("verifyEmail.submit")}
            />
          </View>
        </MenuCard>
      </View>
    </MenuLayout>
  );
}

const styles = StyleSheet.create({
  contentWrapper: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    gap: Spacing.md,
  },
  form: { gap: Spacing.md },
  body: { ...Type.body, lineHeight: FontSize.sm * 1.4 },
  field: { gap: Spacing.sm },
  label: {
    ...Type.label,
    fontSize: FontSize.xs,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.wide,
    paddingVertical: Spacing.wide,
    minHeight: TOUCH_TARGET_MIN,
    gap: Spacing.snug,
  },
  inputIcon: {},
  input: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.md,
    color: Colors.text,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.redMuted,
    borderRadius: Radius.sm,
    padding: Spacing.cosy,
  },
  errorText: { fontFamily: "Inter_400Regular", fontSize: FontSize.sm, color: Colors.dangerDim, flex: 1 },
});
