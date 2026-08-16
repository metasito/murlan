// template
import { router, Stack } from "expo-router";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "@/lib/i18n";
import { Colors, Spacing, Type } from "@/lib/theme";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuButton } from "@/components/MenuButton";

export default function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <>
      <Stack.Screen options={{ title: t("notFound.screenTitle") }} />
      <MenuLayout scrollable={false} centered contentPad={Spacing.lg}>
        <View style={{ alignItems: "center", gap: Spacing.md, maxWidth: 320 }}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.textMuted} />
          <Text style={[Type.heading, { textAlign: "center" }]} accessibilityRole="header">
            {t("notFound.title")}
          </Text>
          <View style={{ width: "100%", marginTop: Spacing.md }}>
            <MenuButton
              label={t("notFound.link")}
              // This screen is itself the fallback for a broken route, so
              // "back" is not a valid destination — replace, don't push.
              onPress={() => router.replace("/")}
              variant="primary"
              icon={<Ionicons name="home" size={18} color={Colors.bg} />}
            />
          </View>
        </View>
      </MenuLayout>
    </>
  );
}
