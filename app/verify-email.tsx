import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { router } from "expo-router";
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
 * Reachable signed-in or signed-out: the redeem route is public — the token
 * is the credential (server/authTokens.ts) — and a player who read the mail
 * on another device may land here with no session on this one at all.
 */
export default function VerifyEmailScreen() {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
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
      setVerified(true);
    } catch (e: unknown) {
      setError(serverErrorMessage(e, t("verifyEmail.failed")));
    }
    setLoading(false);
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

              <FormField label={t("verifyEmail.codeLabel")} icon="key-outline">
                <TextInput
                  style={fieldStyles.input}
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
              </FormField>

              {error && <FormNotice tone="error" text={error} />}

              <MenuButton
                label={loading ? t("verifyEmail.saving") : t("verifyEmail.submit")}
                onPress={submit}
                variant="primary"
                loading={loading}
                accessibilityLabel={t("verifyEmail.submit")}
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
