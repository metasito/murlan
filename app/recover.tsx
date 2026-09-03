import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { router } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { FormField, FormNotice, fieldStyles } from "@/components/FormField";
import { useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/query-client";
import { serverErrorMessage } from "@/lib/apiError";
import { Colors, Spacing } from "@/lib/theme";

type Step = "request" | "reset";

/**
 * Two steps, one screen, because they are one errand: request a reset by
 * email, then redeem the code and choose a new password. A player who
 * already holds a code — closed the app, read the mail, came back — skips
 * step 1 rather than requesting a second one.
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
      // reset-password mints no session: the password just chosen is the
      // thing to prove, not this request.
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
              <Text style={fieldStyles.body}>{t("recover.requestIntro")}</Text>

              <FormField label={t("recover.emailLabel")} icon="mail-outline">
                <TextInput
                  style={fieldStyles.input}
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
              </FormField>

              {error && <FormNotice tone="error" text={error} />}

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
              <Text style={fieldStyles.body}>{t("recover.noticeBody")}</Text>

              <FormField label={t("recover.codeLabel")} icon="key-outline">
                <TextInput
                  style={fieldStyles.input}
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
              </FormField>

              <FormField label={t("recover.newPasswordLabel")} icon="lock-closed-outline">
                <TextInput
                  style={fieldStyles.input}
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
              </FormField>

              {error && <FormNotice tone="error" text={error} />}

              <MenuButton
                label={loading ? t("recover.resetSaving") : t("recover.resetSubmit")}
                onPress={submitReset}
                variant="primary"
                loading={loading}
                accessibilityLabel={t("recover.resetSubmit")}
              />
              <MenuButton
                label={t("recover.backToEmail")}
                onPress={() => { setError(null); setCode(""); setStep("request"); }}
                variant="ghost"
                size="sm"
                accessibilityLabel={t("recover.backToEmail")}
              />
            </View>
          )}
        </MenuCard>
      </View>
    </MenuLayout>
  );
}

const CONTENT_MAX_W = 480;

const styles = StyleSheet.create({
  contentWrapper: {
    width: "100%",
    maxWidth: CONTENT_MAX_W,
    alignSelf: "center",
    gap: Spacing.md,
  },
  form: { gap: Spacing.md },
});
