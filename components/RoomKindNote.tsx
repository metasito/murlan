import { View, Text, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { t } from "@/lib/i18n";
import { Colors, FontSize, Spacing } from "@/lib/theme";
import { a11yHidden } from "@/lib/a11y";

type RoomVisibility = "public" | "private";

const COPY = {
  private: { icon: "lock-closed-outline", body: "room.kindPrivateBody" },
  public: { icon: "globe-outline", body: "room.kindPublicBody" },
} as const;

/**
 * Who can reach this room, said out loud under the code.
 *
 * One muted line, weighted like the code's own label rather than boxed. The
 * room screen is at its tightest in phone landscape, where the start button
 * sits at the bottom of a scrolling column and anything taller here pushes it
 * off the fold — `tests/e2e/tapTargets.spec.ts` counts what stays reachable.
 *
 * An unrecognised visibility renders nothing. The alternative is defaulting to
 * one of the two, which states the opposite of the truth half the time — about
 * the one thing a host is reading this to find out.
 */
export function RoomKindNote({ visibility }: { visibility: RoomVisibility }) {
  const copy = COPY[visibility];
  if (!copy) return null;

  return (
    <View style={styles.note}>
      <Ionicons name={copy.icon} size={FontSize.xs} color={Colors.textMuted} {...a11yHidden()} />
      <Text style={styles.body}>{t(copy.body)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  body: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    flexShrink: 1,
  },
});
