// What a panel shows when it has nothing to show: it is loading, it could not
// load, or there is genuinely nothing there.
//
// One set for every screen, because the three used to be written per screen and
// the same "couldn't load" sentence rendered at three sizes and two weights.
import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { MenuButton } from "@/components/MenuButton";
import { Colors, Spacing, Type } from "@/lib/theme";
import { a11yGroup, a11yHidden } from "@/lib/a11y";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const STATE_ICON = 28;
const RETRY_ICON = 16;

export function LoadingBlock({ label }: { label: string }) {
  return (
    <View style={styles.block}>
      <ActivityIndicator color={Colors.gold} accessibilityLabel={label} />
    </View>
  );
}

/**
 * Grouped only when there is nothing to retry: a group holding a control seals
 * that control inside a leaf on iOS, so the retrying form has to stay a plain
 * container with its own text left readable.
 */
export function ErrorBlock({
  title,
  body,
  retry,
}: {
  title: string;
  body?: string;
  /** Absent where the failure is terminal — a replay that will not parse. */
  retry?: { label: string; a11yLabel: string; onPress: () => void };
}) {
  const grouped = retry === undefined;
  const hide = grouped ? a11yHidden() : {};
  return (
    <View
      style={styles.block}
      {...(grouped ? a11yGroup(body ? `${title}. ${body}` : title) : {})}
    >
      <Ionicons
        name="alert-circle-outline"
        size={STATE_ICON}
        color={Colors.textMuted}
        {...a11yHidden()}
      />
      <Text style={styles.title} {...hide}>
        {title}
      </Text>
      {body !== undefined && (
        <Text style={styles.body} {...hide}>
          {body}
        </Text>
      )}
      {retry && (
        <MenuButton
          label={retry.label}
          onPress={retry.onPress}
          variant="secondary"
          size="sm"
          fullWidth={false}
          accessibilityLabel={retry.a11yLabel}
          icon={<Ionicons name="refresh" size={RETRY_ICON} color={Colors.gold} />}
        />
      )}
    </View>
  );
}

export function EmptyBlock({
  icon,
  title,
  body,
}: {
  icon: IconName;
  title: string;
  body?: string;
}) {
  return (
    <View style={styles.block} {...a11yGroup(body ? `${title}. ${body}` : title)}>
      <Ionicons name={icon} size={STATE_ICON} color={Colors.textMuted} {...a11yHidden()} />
      <Text style={styles.title} {...a11yHidden()}>
        {title}
      </Text>
      {body !== undefined && (
        <Text style={styles.body} {...a11yHidden()}>
          {body}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { alignItems: "center", paddingVertical: Spacing.lg, gap: Spacing.sm },
  title: { ...Type.label, textAlign: "center" },
  body: { ...Type.caption, textAlign: "center", lineHeight: 18, maxWidth: 280 },
});
