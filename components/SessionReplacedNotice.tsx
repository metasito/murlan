import React from "react";
import { StyleSheet, View, Text } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Colors, Spacing, Radius, FontSize, Type } from "@/lib/theme";
import { MenuButton } from "@/components/MenuButton";
import { useTranslation, type ServerPayload } from "@/lib/i18n";
import { AppModal } from "./AppModal";

// Local to this one screen: a round badge sized to the icon it holds, and the
// leading the body copy is set at.
const BADGE_SIZE = 76;
const ICON_SIZE = 36;
const MESSAGE_LINE_HEIGHT = 22;
const CONTENT_MAX_W = 420;

/**
 * The account was opened somewhere else and this connection was closed for it.
 * Covers whatever screen the player was on: a game table left behind here goes
 * on rendering a full hand and an enabled Gioca button while receiving
 * nothing, so the state has to be stated rather than implied.
 *
 * Rendered in the view tree rather than through `Alert`, which is a no-op in
 * react-native-web — and the web bundle is what Replit serves.
 */
export function SessionReplacedNotice({
  payload,
  onReconnect,
}: {
  payload: ServerPayload;
  onReconnect: () => void;
}) {
  const { t, translateServerPayload } = useTranslation();

  return (
    // Nothing to close to: the connection is gone and Reconnect is the only way
    // out, so Escape and the Android back gesture are answered and ignored.
    <AppModal accessibilityLabel={t("sessionReplaced.title")} onRequestClose={() => {}}>
      <View style={styles.overlay} accessibilityViewIsModal accessibilityRole="alert">
        <View style={styles.content}>
          <View style={styles.iconBadge}>
            <Feather name="wifi-off" size={ICON_SIZE} color={Colors.gold} />
          </View>
          <Text style={styles.title}>{t("sessionReplaced.title")}</Text>
          <Text style={styles.message}>{translateServerPayload(payload)}</Text>
          <View style={styles.actions}>
            <MenuButton
              label={t("sessionReplaced.reconnect")}
              onPress={onReconnect}
              variant="primary"
              hint={t("sessionReplaced.reconnectA11yHint")}
            />
          </View>
        </View>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // Above the notification banner and the offline banner, both of which
    // report a connection this screen has already ruled on.
    zIndex: 10001,
    backgroundColor: Colors.overlayOpaque,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    width: "100%",
    maxWidth: CONTENT_MAX_W,
  },
  iconBadge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: Radius.full,
    backgroundColor: Colors.bgSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...Type.title,
    color: Colors.gold,
    textAlign: "center",
  },
  message: {
    ...Type.body,
    fontSize: FontSize.md,
    lineHeight: MESSAGE_LINE_HEIGHT,
    textAlign: "center",
  },
  actions: {
    width: "100%",
    marginTop: Spacing.xs,
  },
});
