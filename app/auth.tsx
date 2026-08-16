import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/context/AuthContext";
import { Colors, Spacing, FontSize, Type } from "@/lib/theme";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { useTranslation, translateServerPayload } from "@/lib/i18n";

type Tab = "login" | "register";

export default function AuthScreen() {
  const { t } = useTranslation();
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    try {
      if (tab === "login") {
        await login(username.trim(), password);
      } else {
        await register(username.trim(), password);
      }
      router.replace("/");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("auth.unknownError");
      const match = msg.match(/\d+: (.+)/);
      try {
        const parsed = JSON.parse(match ? match[1] : msg);
        setError(translateServerPayload(parsed) ?? msg);
      } catch {
        setError(match ? match[1] : msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <MenuLayout scrollable centered={false}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            hitSlop={12}
          >
            <Ionicons name="chevron-back" size={22} color={Colors.gold} />
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
                  accessibilityRole="tab"
                  accessibilityLabel={tabOption === "login" ? t("auth.tabLogin") : t("auth.tabRegister")}
                  accessibilityState={{ selected: tab === tabOption }}
                >
                  <Text style={[styles.tabText, tab === tabOption && styles.tabTextActive]}>
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
                    returnKeyType="next"
                    onSubmitEditing={() => pwdRef.current?.focus()}
                    accessibilityLabel={t("auth.usernameA11yLabel")}
                    accessibilityHint={t("auth.usernameA11yHint")}
                  />
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
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                    accessibilityLabel={t("auth.passwordA11yLabel")}
                    accessibilityHint={t("auth.passwordA11yHint")}
                  />
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
                    />
                  </Pressable>
                </View>
              </View>

              {error && (
                <View style={styles.errorBox} accessible accessibilityLiveRegion="polite">
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
    </KeyboardAvoidingView>
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
    width: 44,
    height: 44,
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
    fontSize: 40,
    color: Colors.text,
    letterSpacing: 10,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.gold,
    letterSpacing: 3,
    textTransform: "uppercase",
    marginTop: 6,
  },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: Colors.border, marginHorizontal: -Spacing.md, marginTop: -Spacing.md },
  tabBtn: { flex: 1, paddingVertical: 16, minHeight: 44, alignItems: "center", justifyContent: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.gold },
  tabText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 16,
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  tabTextActive: { color: Colors.gold },
  form: { paddingTop: Spacing.md, gap: 18 },
  field: { gap: 8 },
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 44,
    gap: 10,
  },
  inputIcon: {},
  input: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.text,
  },
  eyeBtn: { padding: 2, width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.redMuted,
    borderRadius: 10,
    padding: 12,
  },
  errorText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.dangerDim, flex: 1 },
  hint: {
    ...Type.caption,
    textAlign: "center",
    lineHeight: 18,
  },
});
