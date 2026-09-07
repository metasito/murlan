import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { EmptyBlock } from "@/components/StateBlock";
import { FormField, FormNotice, fieldStyles } from "@/components/FormField";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/query-client";
import { serverErrorMessage } from "@/lib/apiError";
import { Colors, Spacing } from "@/lib/theme";

/**
 * Reachable signed-in or signed-out: the redeem route is public — the code
 * plus the email it was sent to is the credential (server/authTokens.ts) —
 * and a player who read the mail on another device may land here with no
 * session on this one at all. The email field is prefilled from the signed-in
 * user or the `email` route param (set by app/auth.tsx after signup) but
 * stays editable for that signed-out case.
 */
export default function VerifyEmailScreen() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(user?.email ?? params.email ?? "");
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    const trimmedEmail = email.trim();
    const trimmedCode = code.trim();
    if (!trimmedEmail) {
      setError(t("verifyEmail.missingEmail"));
      return;
    }
    if (!trimmedCode) {
      setError(t("verifyEmail.missingCode"));
      return;
    }
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/verify-email", { email: trimmedEmail, code: trimmedCode });
      await refreshUser();
      setVerified(true);
    } catch (e: unknown) {
      setError(serverErrorMessage(e, t("verifyEmail.failed")));
    }
    setLoading(false);
  }

  async function resend() {
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      await apiRequest("POST", "/api/auth/resend-verification", {});
      setNotice(t("verifyEmail.resendSent"));
    } catch (e: unknown) {
      setError(serverErrorMessage(e, t("verifyEmail.resendFailed")));
    }
    setResending(false);
  }

  // Typing the URL is a way in on web, so there is not always somewhere to
  // go back to.
  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  return (
    <MenuLayout scrollable centered={false}>
      <ScreenHeader title={t("verifyEmail.title")} />

      <View style={styles.contentWrapper}>
        <MenuCard padding="sm">
          {verified ? (
            <View style={styles.form}>
              <EmptyBlock
                icon="checkmark-circle-outline"
                title={t("verifyEmail.successTitle")}
                body={t("verifyEmail.successBody")}
              />
              <MenuButton label={t("verifyEmail.done")} onPress={leave} variant="primary" />
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={fieldStyles.body}>{t("verifyEmail.body")}</Text>

              <FormField label={t("auth.emailLabel")} icon="mail-outline">
                <TextInput
                  style={fieldStyles.input}
                  value={email}
                  onChangeText={(v) => { setEmail(v); setError(null); }}
                  placeholder={t("auth.emailPlaceholder")}
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  accessibilityLabel={t("auth.emailA11yLabel")}
                  testID="input-verify-email-address"
                />
              </FormField>

              <FormField label={t("verifyEmail.codeLabel")} icon="key-outline">
                <TextInput
                  style={fieldStyles.input}
                  value={code}
                  onChangeText={(v) => { setCode(v); setError(null); }}
                  placeholder={t("verifyEmail.codePlaceholder")}
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="number-pad"
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={submit}
                  accessibilityLabel={t("verifyEmail.codeA11yLabel")}
                  testID="input-verify-email-code"
                />
              </FormField>

              {error && <FormNotice tone="error" text={error} />}
              {notice && <FormNotice tone="success" text={notice} />}

              <MenuButton
                label={loading ? t("verifyEmail.saving") : t("verifyEmail.submit")}
                onPress={submit}
                variant="primary"
                loading={loading}
                accessibilityLabel={t("verifyEmail.submit")}
              />

              {user && !user.emailVerified && (
                <MenuButton
                  label={resending ? t("verifyEmail.resending") : t("verifyEmail.resend")}
                  onPress={resend}
                  variant="ghost"
                  size="sm"
                  loading={resending}
                  accessibilityLabel={t("verifyEmail.resend")}
                />
              )}
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
