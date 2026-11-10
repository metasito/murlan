// The portrait cover on the game table. Not a Modal: a presented modal held back
// the very layout that would have lifted it (#1378). The table veils itself behind
// the cover, and on iOS the cover hides its siblings from VoiceOver.

import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Animated, { type CSSAnimationKeyframes } from "react-native-reanimated";
import { TableText } from "./TableText";
import { portraitOverlayStyles } from "./chrome";
import { ROTATE_SETTLED, ROTATE_UPRIGHT, rotateGlyphAngle } from "./rotateGlyph";
import { a11yGroup, a11yHidden } from "@/lib/a11y";
import { SINE_EASE, useAmbient } from "@/lib/motion";
import { useTranslation } from "@/lib/i18n";
import { Colors, Motion } from "@/lib/theme";

const GLYPH_SIZE = 56;
const TURN_MS = Motion.duration.reveal;
/** Long enough to read as an instruction rather than as a spinner. */
const HOLD_SETTLED = Motion.duration.dwell;
const HOLD_UPRIGHT = Motion.duration.travel;
const PERIOD = HOLD_UPRIGHT + TURN_MS + HOLD_SETTLED + TURN_MS;
const turned = (turn: number) => ({ transform: [{ rotate: `${rotateGlyphAngle(turn)}deg` }] });
const RESTING = turned(ROTATE_SETTLED);
const at = (ms: number) => `${(100 * ms) / PERIOD}%`;
const TURNING: CSSAnimationKeyframes = {
  "0%": { ...turned(ROTATE_UPRIGHT), animationTimingFunction: SINE_EASE },
  [at(HOLD_UPRIGHT)]: { ...turned(ROTATE_UPRIGHT), animationTimingFunction: SINE_EASE },
  [at(HOLD_UPRIGHT + TURN_MS)]: { ...turned(ROTATE_SETTLED), animationTimingFunction: SINE_EASE },
  [at(HOLD_UPRIGHT + TURN_MS + HOLD_SETTLED)]: { ...turned(ROTATE_SETTLED), animationTimingFunction: SINE_EASE },
  "100%": turned(ROTATE_UPRIGHT),
};

export function RotateOverlay() {
  const { t } = useTranslation();
  const glyphStyle = useAmbient({ keyframes: TURNING, duration: PERIOD, delay: -(HOLD_UPRIGHT + TURN_MS + HOLD_SETTLED) });

  return (
    <View testID="rotate-overlay" style={portraitOverlayStyles.overlay} accessibilityViewIsModal>
      <View style={portraitOverlayStyles.card} {...a11yGroup(t("gameTable.rotateA11yLabel"))}>
        <Animated.View style={[RESTING, glyphStyle]} {...a11yHidden()}>
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
