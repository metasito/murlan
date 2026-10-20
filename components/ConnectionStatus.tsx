import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Colors, FontSize, Radius, Spacing } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden } from "@/lib/a11y";

const DOT = 8;

/** The online socket's state: a dot by colour, and the words for whoever cannot read the colour. */
export function ConnectionStatus({
  connected,
  username,
  style,
}: {
  connected: boolean;
  username: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.row, style]}>
      <View
        style={[styles.dot, { backgroundColor: connected ? Colors.success : Colors.textMuted }]}
        {...a11yHidden()}
      />
      <Text style={styles.text}>
        {connected ? t("onlineLobby.connectedAs", { username }) : t("onlineLobby.connecting")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  dot: { width: DOT, height: DOT, borderRadius: Radius.full },
  text: { fontFamily: "Inter_400Regular", fontSize: FontSize.sm, color: Colors.textMuted },
});
