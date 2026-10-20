// The portrait cover on the game table. Not a Modal: a presented modal held back
// the very layout that would have lifted it (#1378). The table veils itself behind
// the cover, and on iOS the cover hides its siblings from VoiceOver.

import { useEffect } from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { TableText } from "./TableText";
import { portraitOverlayStyles } from "./chrome";
import { ROTATE_SETTLED, ROTATE_UPRIGHT, rotateGlyphAngle } from "./rotateGlyph";
import { a11yGroup, a11yHidden } from "@/lib/a11y";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useLoop } from "@/lib/motion";
import { useTranslation } from "@/lib/i18n";
import { Colors, Motion } from "@/lib/theme";

const GLYPH_SIZE = 56;
const TURN_MS = Motion.duration.reveal;
/** Long enough to read as an instruction rather than as a spinner. */
const HOLD_SETTLED = Motion.duration.dwell;
const HOLD_UPRIGHT = Motion.duration.travel;
const EASE = Easing.inOut(Easing.sin);

export function RotateOverlay() {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  // Seeded in the pose being asked for, so a preference that resolves after
  // the first frame parks on it rather than snapping to it.
  const turn = useSharedValue(ROTATE_SETTLED);

  useLoop(turn, () => {
    const leg = (to: number) => withTiming(to, { duration: TURN_MS, easing: EASE });
    return {
      lead: leg(ROTATE_UPRIGHT),
      cycle: withSequence(
        withDelay(HOLD_UPRIGHT, leg(ROTATE_SETTLED), ReduceMotion.System),
        withDelay(HOLD_SETTLED, leg(ROTATE_UPRIGHT), ReduceMotion.System)
      ),
    };
  });
  useEffect(() => {
    if (reduceMotion) turn.set(ROTATE_SETTLED);
  }, [reduceMotion, turn]);

  const glyphStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotateGlyphAngle(turn.value)}deg` }],
  }));

  return (
    <View testID="rotate-overlay" style={portraitOverlayStyles.overlay} accessibilityViewIsModal>
      <View style={portraitOverlayStyles.card} {...a11yGroup(t("gameTable.rotateA11yLabel"))}>
        <Animated.View style={glyphStyle} {...a11yHidden()}>
          <Ionicons name="phone-landscape-outline" size={GLYPH_SIZE} color={Colors.gold} {...a11yHidden()} />
        </Animated.View>
        <TableText style={portraitOverlayStyles.title} {...a11yHidden()}>
          {t("gameTable.rotateTitle")}
        </TableText>
        <TableText style={portraitOverlayStyles.sub} {...a11yHidden()}>
          {t("gameTable.rotateBody")}
        </TableText>
      </View>
    </View>
  );
}
