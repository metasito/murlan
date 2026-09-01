// What a panel shows when it has nothing to show: it is loading, it could not
// load, or there is genuinely nothing there.
import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { MenuButton } from "@/components/MenuButton";
import { Colors, Spacing, Type } from "@/lib/theme";
import { a11yGroup, a11yHidden } from "@/lib/a11y";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const BODY_LINE_H = 18;
/** Holds the sentence to roughly two lines on a phone, so it reads as one thought. */
const BODY_MAX_W = 280;

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
 * A failure with a way out of it. Not grouped, unlike the other blocks in this
 * file: it holds a control, and a group holding a control seals that control
 * inside a leaf on iOS. Two shapes rather than one branching on `retry` — a
 * conditional group is a group the source scan cannot rule on.
 */
export function ErrorBlock({
  title,
  body,
  retry,
}: {
  title: string;
  body?: string;
  retry: { label: string; a11yLabel: string; onPress: () => void };
}) {
  return (
    <View style={styles.block}>
      <Ionicons
        name="alert-circle-outline"
        size={STATE_ICON}
        color={Colors.textMuted}
        {...a11yHidden()}
      />
      <Text style={styles.title}>{title}</Text>
      {body !== undefined && <Text style={styles.body}>{body}</Text>}
      <MenuButton
        label={retry.label}
        onPress={retry.onPress}
        variant="secondary"
        size="sm"
        fullWidth={false}
        accessibilityLabel={retry.a11yLabel}
        icon={<Ionicons name="refresh" size={RETRY_ICON} color={Colors.gold} />}
      />
    </View>
  );
}

/** A failure there is no way out of — a replay that will not parse. */
export function TerminalErrorBlock({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.block} {...a11yGroup(`${title}. ${body}`)}>
      <Ionicons
        name="alert-circle-outline"
        size={STATE_ICON}
        color={Colors.textMuted}
        {...a11yHidden()}
      />
      <Text style={styles.title} {...a11yHidden()}>
        {title}
      </Text>
      <Text style={styles.body} {...a11yHidden()}>
        {body}
      </Text>
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
  body: { ...Type.caption, textAlign: "center", lineHeight: BODY_LINE_H, maxWidth: BODY_MAX_W },
});
