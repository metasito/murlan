// The portrait cover on the game table. A Modal, not a scrim: covering the
// pixels would leave every control beneath it in the tab order. Rotating back
// is the only way out, so onRequestClose is inert.

import { useEffect } from "react";
import { Modal, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { TableText } from "./TableText";
import { portraitOverlayStyles } from "./chrome";
import { ROTATE_SETTLED, ROTATE_UPRIGHT, rotateGlyphAngle } from "../gameTableModel";
import { a11yHidden } from "@/lib/a11y";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import { Colors, Motion } from "@/lib/theme";

const GLYPH_SIZE = 56;
const TURN = Motion.duration.slow;
/** Long enough to read as an instruction rather than as a spinner. */
const HOLD_SETTLED = Motion.duration.pulse;
const HOLD_UPRIGHT = Motion.duration.moderate;
const EASE = Easing.inOut(Easing.sin);

export function RotateOverlay() {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const turn = useSharedValue(ROTATE_SETTLED);

  useEffect(() => {
    if (reduceMotion) {
      turn.value = ROTATE_SETTLED;
      return;
    }
    // Each loop leaves from the pose the player is holding.
    turn.value = ROTATE_UPRIGHT;
    turn.value = withRepeat(
      withSequence(
        withDelay(HOLD_UPRIGHT, withTiming(ROTATE_SETTLED, { duration: TURN, easing: EASE })),
        withDelay(HOLD_SETTLED, withTiming(ROTATE_UPRIGHT, { duration: TURN, easing: EASE }))
      ),
      -1,
      false
    );
  }, [reduceMotion, turn]);

  const glyphStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotateGlyphAngle(turn.value)}deg` }],
  }));

  return (
    <Modal
      transparent
      visible
      // Both lines, because the card below is hidden: what the cover says has
      // to arrive as one announcement rather than as three nodes.
      accessibilityLabel={`${t("gameTable.rotateTitle")}. ${t("gameTable.rotateBody")}`}
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={() => {}}
    >
      <View style={portraitOverlayStyles.overlay}>
        <View style={portraitOverlayStyles.card} {...a11yHidden()}>
          <Animated.View style={glyphStyle}>
            <Ionicons name="phone-landscape-outline" size={GLYPH_SIZE} color={Colors.gold} />
          </Animated.View>
          <TableText style={portraitOverlayStyles.title}>{t("gameTable.rotateTitle")}</TableText>
          <TableText style={portraitOverlayStyles.sub}>{t("gameTable.rotateBody")}</TableText>
        </View>
      </View>
    </Modal>
  );
}
