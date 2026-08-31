import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
} from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { hapticLight } from "@/lib/haptics";
import { useAuth } from "@/context/AuthContext";
import { Colors, FontSize, Radius, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { useTranslation } from "@/lib/i18n";
import { serverErrorMessage } from "@/lib/apiError";
import { a11yHidden, a11yState, useA11yHint } from "@/lib/a11y";

type Tab = "login" | "register";

export default function AuthScreen() {
  const { t } = useTranslation();
  const usernameHint = useA11yHint(t("auth.usernameA11yHint"));
  const passwordHint = useA11yHint(t("auth.passwordA11yHint"));
  const { login, register } = useAuth();
  const [tab, setTab] = useState<Tab>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pwdRef = useRef<TextInput>(null);

  async function handleSubmit() {
    setError(null);
    if (!username.trim() || !password.trim()) {
      setError(t("auth.missingFields"));
      return;
    }
    hapticLight();
    setLoading(true);
    try {
      if (tab === "login") {
        await login(username.trim(), password);
      } else {
        await register(username.trim(), password);
      }
      router.replace("/");
    } catch (e: unknown) {
      setError(serverErrorMessage(e, t("auth.unknownError")));
    }
    setLoading(false);
  }

  return (
    <MenuLayout scrollable centered={false}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={22} color={Colors.gold} {...a11yHidden()} />
        </Pressable>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.contentWrapper}>
        <View style={styles.header}>
          <Text style={styles.title}>MURLAN</Text>
          <Text style={styles.subtitle}>{t("auth.subtitle")}</Text>
        </View>

        <MenuCard style={{ marginBottom: 0 }} padding="sm">
          <View style={styles.tabs}>
            {(["login", "register"] as Tab[]).map((tabOption) => (
              <Pressable
                key={tabOption}
                onPress={() => { setTab(tabOption); setError(null); }}
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
                  onSubmitEditing={() => pwdRef.current?.focus()}
                  accessibilityLabel={t("auth.usernameA11yLabel")}
                  {...usernameHint.props}
                />
                {usernameHint.node}
              </View>
            </View>

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
                  hitSlop={10}
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

            {tab === "register" && (
              <Text style={styles.hint}>{t("auth.hint")}</Text>
            )}
          </View>
        </MenuCard>
      </View>
    </MenuLayout>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginBottom: Spacing.xs,
  },
  backBtn: {
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
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
  hint: {
    ...Type.caption,
    textAlign: "center",
    lineHeight: 18,
  },
});
