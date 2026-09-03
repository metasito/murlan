import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ScreenHeader } from "@/components/ScreenHeader";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/query-client";
import { serverErrorMessage } from "@/lib/apiError";
import { Colors, FontSize, Radius, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";

type Step = "request" | "reset";

/**
 * Two steps, one screen, because they are one errand (design doc): request a
 * reset by email, then redeem the code and choose a new password. A player
 * who already holds a code — closed the app, read the mail, came back —
 * skips step 1 via "I already have a code" rather than requesting a second
 * one.
 */
export default function RecoverScreen() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitRequest() {
    if (!email.trim()) {
      setError(t("recover.missingEmail"));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/request-password-reset", { email: email.trim() });
      setStep("reset");
    } catch (e: unknown) {
      setError(serverErrorMessage(e, t("recover.requestFailed")));
    }
    setLoading(false);
  }

  async function submitReset() {
    if (!code.trim() || !newPassword.trim()) {
      setError(t("recover.missingFields"));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/reset-password", { token: code.trim(), newPassword });
      // reset-password returns no session (design doc): the password the
      // player just chose is the thing to prove, not this request.
      router.replace({ pathname: "/auth", params: { notice: "passwordReset" } });
    } catch (e: unknown) {
      setError(serverErrorMessage(e, t("recover.resetFailed")));
    }
    setLoading(false);
  }

  return (
    <MenuLayout scrollable centered={false}>
      <ScreenHeader title={t("recover.title")} />

      <View style={styles.contentWrapper}>
        <MenuCard padding="sm">
          {step === "request" ? (
            <View style={styles.form}>
              <Text style={styles.body}>{t("recover.requestIntro")}</Text>

              <View style={styles.field}>
                <Text style={styles.label}>{t("recover.emailLabel")}</Text>
                <View style={styles.inputRow}>
                  <Ionicons name="mail-outline" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={(v) => { setEmail(v); setError(null); }}
                    placeholder={t("recover.emailPlaceholder")}
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    autoComplete="email"
                    textContentType="emailAddress"
                    returnKeyType="done"
                    onSubmitEditing={submitRequest}
                    accessibilityLabel={t("recover.emailA11yLabel")}
                    testID="input-recover-email"
                  />
                </View>
              </View>

              {error && (
                <View style={styles.errorBox} accessibilityLiveRegion="polite">
                  <Ionicons name="alert-circle-outline" size={14} color={Colors.dangerDim} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <MenuButton
                label={loading ? t("recover.requestSaving") : t("recover.requestSubmit")}
                onPress={submitRequest}
                variant="primary"
                loading={loading}
                accessibilityLabel={t("recover.requestSubmit")}
              />
              <MenuButton
                label={t("recover.haveCodeAlready")}
                onPress={() => { setError(null); setStep("reset"); }}
                variant="ghost"
                size="sm"
                accessibilityLabel={t("recover.haveCodeAlready")}
              />
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.body}>{t("recover.noticeBody")}</Text>

              <View style={styles.field}>
                <Text style={styles.label}>{t("recover.codeLabel")}</Text>
                <View style={styles.inputRow}>
                  <Ionicons name="key-outline" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={code}
                    onChangeText={(v) => { setCode(v); setError(null); }}
                    placeholder={t("recover.codePlaceholder")}
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    accessibilityLabel={t("recover.codeA11yLabel")}
                    testID="input-recover-code"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("recover.newPasswordLabel")}</Text>
                <View style={styles.inputRow}>
                  <Ionicons name="lock-closed-outline" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={newPassword}
                    onChangeText={(v) => { setNewPassword(v); setError(null); }}
                    placeholder={t("recover.newPasswordPlaceholder")}
                    placeholderTextColor={Colors.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    returnKeyType="done"
                    onSubmitEditing={submitReset}
                    accessibilityLabel={t("recover.newPasswordA11yLabel")}
                    testID="input-recover-new-password"
                  />
                </View>
              </View>

              {error && (
                <View style={styles.errorBox} accessibilityLiveRegion="polite">
                  <Ionicons name="alert-circle-outline" size={14} color={Colors.dangerDim} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <MenuButton
                label={loading ? t("recover.resetSaving") : t("recover.resetSubmit")}
                onPress={submitReset}
                variant="primary"
                loading={loading}
                accessibilityLabel={t("recover.resetSubmit")}
              />
            </View>
          )}
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
