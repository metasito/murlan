import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { a11yHidden } from "@/lib/a11y";
import { Colors, FontSize, Radius, Shadow, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  /** Omitted for a notice the player can only acknowledge. */
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

/**
 * The question `Alert.alert` cannot ask on the web.
 *
 * react-native-web's `Alert` is `static alert() {}` — an empty function — so
 * every confirmation built on it showed nothing at all on the bundle Replit
 * serves, and its destructive branch simply never ran. React Native's Modal
 * is also what buys the focus trap and Escape (tests/blockingOverlays.test.ts).
 */
export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const dismissable = request?.cancelLabel !== undefined;

  return (
    <Modal
      visible={request !== null}
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={dismissable ? onClose : undefined}
      statusBarTranslucent
      // iOS defaults this to portrait only, which rotates the whole app when the
      // modal opens in landscape and leaves the screen behind it mis-laid-out.
      supportedOrientations={["portrait", "landscape"]}
    >
      {request && (
        <View style={styles.backdrop}>
          {dismissable && (
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} {...a11yHidden()} />
          )}
          <View style={styles.card} accessibilityViewIsModal accessibilityRole="none">
            <Text style={styles.title} accessibilityRole="header">
              {request.title}
            </Text>
            <Text style={styles.body}>{request.body}</Text>
            <View style={styles.actions}>
              {request.cancelLabel !== undefined && (
                <Pressable
                  testID="confirm-cancel"
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel={request.cancelLabel}
                  style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                >
                  <Text style={styles.cancelLabel} {...a11yHidden()}>
                    {request.cancelLabel}
                  </Text>
                </Pressable>
              )}
              <Pressable
                testID="confirm-accept"
                onPress={() => {
                  onClose();
                  request.onConfirm();
                }}
                accessibilityRole="button"
                accessibilityLabel={request.confirmLabel}
                style={({ pressed }) => [
                  styles.action,
                  styles.accept,
                  request.destructive && styles.acceptDestructive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.acceptLabel,
                    request.destructive && styles.acceptLabelDestructive,
                  ]}
                  {...a11yHidden()}
                >
                  {request.confirmLabel}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </Modal>
  );
}

const CARD_MAX_W = 340;
const PRESSED_OPACITY = 0.7;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: CARD_MAX_W,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.overlay,
  },
  title: {
    ...Type.heading,
    color: Colors.gold,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  body: { ...Type.body, color: Colors.textSecondary },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  action: {
    minHeight: TOUCH_TARGET_MIN,
    minWidth: TOUCH_TARGET_MIN,
    paddingHorizontal: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.sm,
  },
  accept: { backgroundColor: Colors.gold },
  acceptDestructive: { backgroundColor: Colors.danger },
  pressed: { opacity: PRESSED_OPACITY },
  cancelLabel: { ...Type.bodyStrong, fontSize: FontSize.md, color: Colors.textSecondary },
  acceptLabel: { ...Type.bodyStrong, fontSize: FontSize.md, color: Colors.bg },
  acceptLabelDestructive: { color: Colors.white },
});
