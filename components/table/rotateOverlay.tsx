// The portrait cover on the game table. A Modal, not a scrim: covering the
// pixels would leave every control beneath it in the tab order. Rotating back
// is the only way out, so onRequestClose is inert.

import { useEffect } from "react";
import { Modal, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Animated, {
  Easing,
  cancelAnimation,
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
const TURN_MS = Motion.duration.slow;
/** Long enough to read as an instruction rather than as a spinner. */
const HOLD_SETTLED = Motion.duration.pulse;
const HOLD_UPRIGHT = Motion.duration.moderate;
const EASE = Easing.inOut(Easing.sin);

export function RotateOverlay() {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  // Seeded in the pose being asked for, so a preference that resolves after
  // the first frame parks on it rather than snapping to it.
  const turn = useSharedValue(ROTATE_SETTLED);

  useEffect(() => {
    if (reduceMotion) {
      turn.value = ROTATE_SETTLED;
      return;
    }
    const leg = (to: number) => withTiming(to, { duration: TURN_MS, easing: EASE });
    turn.value = withSequence(
      leg(ROTATE_UPRIGHT),
      withRepeat(
        withSequence(
          withDelay(HOLD_UPRIGHT, leg(ROTATE_SETTLED)),
          withDelay(HOLD_SETTLED, leg(ROTATE_UPRIGHT))
        ),
        -1,
        false
      )
    );
    return () => cancelAnimation(turn);
  }, [reduceMotion, turn]);

  const glyphStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotateGlyphAngle(turn.value)}deg` }],
  }));

  return (
    <Modal
      transparent
      visible
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={() => {}}
    >
      <View style={portraitOverlayStyles.overlay}>
        {/* The label lives here rather than on the Modal: a Modal's own host
            view is not an accessibility element on iOS, so a label on it is
            read by nothing. */}
        <View
          style={portraitOverlayStyles.card}
          accessible
          accessibilityLabel={t("gameTable.rotateA11yLabel")}
        >
          <Animated.View style={glyphStyle} {...a11yHidden()}>
            <Ionicons name="phone-landscape-outline" size={GLYPH_SIZE} color={Colors.gold} />
          </Animated.View>
          <TableText style={portraitOverlayStyles.title} {...a11yHidden()}>
            {t("gameTable.rotateTitle")}
          </TableText>
          <TableText style={portraitOverlayStyles.sub} {...a11yHidden()}>
            {t("gameTable.rotateBody")}
          </TableText>
        </View>
      </View>
    </Modal>
  );
}
