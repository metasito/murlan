import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { hapticLight } from "@/lib/haptics";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useAuth } from "@/context/AuthContext";
import { Colors, FontSize, Radius, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { useTranslation } from "@/lib/i18n";
import { serverErrorMessage } from "@/lib/apiError";
import { a11yHidden, a11yState, useA11yHint } from "@/lib/a11y";
import { EmptyBlock } from "@/components/StateBlock";

type Tab = "login" | "register";

/** Whether registration signed this device in — see AuthContext.register. */
interface CheckEmailState {
  signedIn: boolean;
}

export default function AuthScreen() {
  const { t } = useTranslation();
  const usernameHint = useA11yHint(t("auth.usernameA11yHint"));
  const emailHint = useA11yHint(t("auth.emailA11yHint"));
  const passwordHint = useA11yHint(t("auth.passwordA11yHint"));
  const { login, register } = useAuth();
  const params = useLocalSearchParams<{ notice?: string }>();
  const [tab, setTab] = useState<Tab>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seeded from the query param app/recover.tsx returns through, once — a
  // later re-render (a field edit, a tab switch) must not resurrect it after
  // the handler below clears it.
  const [notice, setNotice] = useState<string | null>(() =>
    params.notice === "passwordReset" ? t("auth.passwordResetNotice") : null
  );
  const [checkEmail, setCheckEmail] = useState<CheckEmailState | null>(null);
  const emailRef = useRef<TextInput>(null);
  const pwdRef = useRef<TextInput>(null);

  async function handleSubmit() {
    setError(null);
    setNotice(null);
    if (!username.trim() || !password.trim() || (tab === "register" && !email.trim())) {
      setError(t(tab === "register" ? "auth.missingFieldsRegister" : "auth.missingFields"));
      return;
    }
    hapticLight();
    setLoading(true);
    try {
      if (tab === "login") {
        await login(username.trim(), password);
        router.replace("/");
      } else {
        // #897: the response never says whether the address was free — the
        // client only learns whether *this device* ended up signed in, and
        // either way the person must be told to check their email, not sent
        // straight into the app as if nothing happened. `undefined` means
        // that could not be confirmed (the registration itself already
        // succeeded) — that is an error to retry, never a silent "not
        // signed in".
        const signedIn = await register(username.trim(), password, email.trim());
        if (signedIn === undefined) {
          setError(t("auth.unknownError"));
          setLoading(false);
          return;
        }
        setCheckEmail({ signedIn: signedIn !== null });
      }
    } catch (e: unknown) {
      setError(serverErrorMessage(e, t("auth.unknownError")));
    }
    setLoading(false);
  }

  function continueFromCheckEmail() {
    if (checkEmail?.signedIn) {
      router.replace("/");
      return;
    }
    setCheckEmail(null);
    setPassword("");
    setTab("login");
  }

  return (
    <MenuLayout scrollable centered={false}>
      <ScreenHeader />

      <View style={styles.contentWrapper}>
        <View style={styles.header}>
          <Text style={styles.title}>MURLAN</Text>
          <Text style={styles.subtitle}>{t("auth.subtitle")}</Text>
        </View>

        <MenuCard style={{ marginBottom: 0 }} padding="sm">
          {checkEmail ? (
            <View style={styles.checkEmail}>
              <EmptyBlock
                icon="mail-outline"
                title={t("auth.checkEmailTitle")}
                body={t("auth.checkEmailBody")}
              />
              <MenuButton
                label={checkEmail.signedIn ? t("auth.checkEmailContinue") : t("auth.checkEmailBackToSignIn")}
                onPress={continueFromCheckEmail}
                variant="primary"
                accessibilityLabel={
                  checkEmail.signedIn ? t("auth.checkEmailContinue") : t("auth.checkEmailBackToSignIn")
                }
              />
              <MenuButton
                label={t("auth.checkEmailVerifyNow")}
                onPress={() => router.push("/verify-email")}
                variant="ghost"
                size="sm"
                accessibilityLabel={t("auth.checkEmailVerifyNow")}
              />
            </View>
          ) : (
          <>
          <View style={styles.tabs}>
            {(["login", "register"] as Tab[]).map((tabOption) => (
              <Pressable
                key={tabOption}
                onPress={() => { setTab(tabOption); setError(null); setNotice(null); }}
                style={[styles.tabBtn, tab === tabOption && styles.tabActive]}
                accessibilityLabel={tabOption === "login" ? t("auth.tabLogin") : t("auth.tabRegister")}
                {...a11yState({ role: "tab", selected: tab === tabOption })}
              >
                <Text {...a11yHidden()} style={[styles.tabText, tab === tabOption && styles.tabTextActive]}>
                  {tabOption === "login" ? t("auth.tabLogin") : t("auth.tabRegister")}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.form}>
            {notice && (
              <View style={styles.noticeBox} accessibilityLiveRegion="polite">
                <Ionicons name="checkmark-circle-outline" size={14} color={Colors.accent} />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            )}
            <View style={styles.field}>
              <Text style={styles.label}>{t("auth.usernameLabel")}</Text>
              <View style={styles.inputRow}>
                <Ionicons name="person-outline" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={username}
                  onChangeText={(v) => { setUsername(v); setError(null); }}
                  placeholder={t("auth.usernamePlaceholder")}
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  returnKeyType="next"
                  onSubmitEditing={() => (tab === "register" ? emailRef : pwdRef).current?.focus()}
                  accessibilityLabel={t("auth.usernameA11yLabel")}
                  {...usernameHint.props}
                />
                {usernameHint.node}
              </View>
            </View>

            {tab === "register" && (
              <View style={styles.field}>
                <Text style={styles.label}>{t("auth.emailLabel")}</Text>
                <View style={styles.inputRow}>
                  <Ionicons name="mail-outline" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    ref={emailRef}
                    style={styles.input}
                    value={email}
                    onChangeText={(v) => { setEmail(v); setError(null); }}
                    placeholder={t("auth.emailPlaceholder")}
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    autoComplete="email"
                    textContentType="emailAddress"
                    returnKeyType="next"
                    onSubmitEditing={() => pwdRef.current?.focus()}
                    accessibilityLabel={t("auth.emailA11yLabel")}
                    {...emailHint.props}
                  />
                  {emailHint.node}
                </View>
              </View>
            )}

            <View style={styles.field}>
              <Text style={styles.label}>{t("auth.passwordLabel")}</Text>
              <View style={styles.inputRow}>
                <Ionicons name="lock-closed-outline" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  ref={pwdRef}
                  style={[styles.input, { flex: 1 }]}
                  value={password}
                  onChangeText={(v) => { setPassword(v); setError(null); }}
                  placeholder="••••••"
                  placeholderTextColor={Colors.textMuted}
                  secureTextEntry={!showPwd}
                  autoCapitalize="none"
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                  textContentType={tab === "login" ? "password" : "newPassword"}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                  accessibilityLabel={t("auth.passwordA11yLabel")}
                  {...passwordHint.props}
                />
                {passwordHint.node}
                <Pressable
                  onPress={() => setShowPwd((v) => !v)}
                  style={styles.eyeBtn}
                  accessibilityRole="button"
                  accessibilityLabel={showPwd ? t("auth.hidePasswordA11yLabel") : t("auth.showPasswordA11yLabel")}
                  hitSlop={Spacing.snug}
                >
                  <Ionicons
                    name={showPwd ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color={Colors.textMuted}
                    {...a11yHidden()}
                  />
                </Pressable>
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
              label={tab === "login" ? t("auth.submitLogin") : t("auth.submitRegister")}
              onPress={handleSubmit}
              variant="primary"
              loading={loading}
              accessibilityLabel={tab === "login" ? t("auth.submitLogin") : t("auth.submitRegister")}
            />

            {tab === "login" && (
              <MenuButton
                label={t("auth.forgotPassword")}
                onPress={() => router.push("/recover")}
                variant="ghost"
                size="sm"
                accessibilityLabel={t("auth.forgotPassword")}
              />
            )}

            {tab === "register" && (
              <Text style={styles.hint}>{t("auth.hint")}</Text>
            )}
          </View>
          </>
          )}
        </MenuCard>
      </View>
    </MenuLayout>
  );
}

const styles = StyleSheet.create({
  checkEmail: {
    paddingVertical: Spacing.md,
    gap: Spacing.md,
    alignItems: "center",
  },
  contentWrapper: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    gap: Spacing.md,
  },
  header: { alignItems: "center", marginBottom: Spacing.md, marginTop: Spacing.xs },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.hero,
    color: Colors.text,
    letterSpacing: 10,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.gold,
    letterSpacing: 3,
    textTransform: "uppercase",
    marginTop: Spacing.slim,
  },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: Colors.border, marginHorizontal: -Spacing.md, marginTop: -Spacing.md },
  tabBtn: { flex: 1, paddingVertical: Spacing.md, minHeight: TOUCH_TARGET_MIN, alignItems: "center", justifyContent: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.gold },
  tabText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.md,
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  tabTextActive: { color: Colors.gold },
  form: { paddingTop: Spacing.md, gap: Spacing.md },
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
  eyeBtn: { padding: Spacing.xxs, width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.redMuted,
    borderRadius: Radius.sm,
    padding: Spacing.cosy,
  },
  errorText: { fontFamily: "Inter_400Regular", fontSize: FontSize.sm, color: Colors.dangerDim, flex: 1 },
  noticeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.accentMuted,
    borderRadius: Radius.sm,
    padding: Spacing.cosy,
  },
  noticeText: { fontFamily: "Inter_400Regular", fontSize: FontSize.sm, color: Colors.accent, flex: 1 },
  hint: {
    ...Type.caption,
    textAlign: "center",
    lineHeight: 18,
  },
});
