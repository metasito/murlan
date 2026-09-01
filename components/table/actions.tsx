// The table's two keys: GIOCA and PASSA.
//
// Both are the same bevelled object — a lit top edge, a face darkening
// downward, and a press that shrinks the whole key rather than dropping it a
// pixel or two, which at 56pt square would read as a jitter. They differ in
// their metal and in what a press means, so the shared parts are the styles
// below rather than a component with a variant prop.
import { useEffect, useState } from "react";
import { View, StyleSheet, Pressable, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { TableText } from "./TableText";
import { a11yHidden, a11yState } from "@/lib/a11y";
import { useTranslation } from "@/lib/i18n";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { cardSpokenName } from "@/lib/cardNames";
import { Colors, Garnet, Gradient, Highlight, Layer, makeShadow, Motion, Shadow, Spacing, TopEdgeLight } from "@/lib/theme";
import type { Card } from "@/lib/gameEngine";

const BTN_PRESS_SCALE = 0.94;
const BTN_RADIUS = 14;
const BTN_LABEL_FS = 12;
const BTN_SUB_FS = 10;
const BTN_TRACKING = 1.9;
const BTN_GLOW = 26;

// Raked light across the gold surface — bright at the top-left corner,
// dropping to goldDark at the bottom-right — same treatment and same rake
// angle as components/MenuButton.tsx's primary variant, so the table's most-
// pressed control reads as struck metal like every other primary action.
const GIOCA_GRADIENT = Gradient.playButton;
const GIOCA_GRADIENT_PRESSED = [Colors.gold, Colors.goldDark, Colors.goldDim] as const;
const GIOCA_GRADIENT_LOCATIONS = [0, 0.48, 1] as const;

// PASSA takes GIOCA's own construction — a lit top lip, a face darkening
// downward, a seated shadow — at lower luminance with the hue pulled to
// garnet, and no glow. Glow is reserved for the primary action, which is the
// whole reason red can sit here without shouting.
const PASS_GRADIENT = Gradient.garnet;
const PASS_GRADIENT_PRESSED = [Garnet.face, Garnet.deep, Garnet.base, Garnet.base] as const;
const PASS_GRADIENT_LOCATIONS = [0, 0.22, 0.6, 1] as const;

export function GiocaButton({
  lit,
  rejectX,
  flashStyle,
  glowStyle,
  onPress,
  a11yLabel,
  label,
  exchange,
  selectedCount,
  size,
  scale,
}: {
  /** The turn is the viewer's — the key is brass whether or not a play is staged. */
  lit: boolean;
  /** Owned by GameTable — driven by handlePlay's reject shake, not by press. */
  rejectX: SharedValue<number>;
  flashStyle: AnimatedStyle<ViewStyle>;
  glowStyle: AnimatedStyle<ViewStyle>;
  onPress: () => void;
  a11yLabel: string;
  /** What the key reads. The exchange borrows this button, so not always PLAY. */
  label: string;
  /**
   * Set while the exchange has borrowed this key, naming who the card goes to
   * and which one is picked. Named here rather than by the caller: the table
   * already computes several translated strings per render, and one more with
   * a parameter object costs it the React Compiler's memoization outright
   * (scripts/react-compiler-probe.mjs).
   */
  exchange?: { toName: string; picked: Card | null };
  selectedCount: number;
  /** The button is square, and never smaller than a comfortable thumb. */
  size: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const [pressed, setPressed] = useState(false);
  const pressVal = useSharedValue(0);

  // Must precede the effect that reads `pressVal` — the React Compiler skips any component that mutates a value an effect captured.
  const setPress = (down: boolean) => {
    // Gated on the turn, not on the staged play: a press with nothing legal
    // selected is answered by the reject shake and the hint, so it has to feel
    // like a press first.
    if (!lit) return;
    setPressed(down);
    pressVal.value = reduceMotion
      ? down ? 1 : 0
      : withTiming(down ? 1 : 0, { duration: Motion.duration.tap });
  };

  useEffect(() => () => cancelAnimation(pressVal), [pressVal]);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: rejectX.value },
      { scale: 1 - pressVal.value * (1 - BTN_PRESS_SCALE) },
    ],
  }));

  return (
    // Named so a device hierarchy can say whether the wrapper or the control
    // inside it is what went missing (#685).
    <Animated.View
      testID="btn-gioca-box"
      style={[
        styles.actionBtn,
        { width: size, height: size, borderRadius: BTN_RADIUS * scale },
        pressStyle,
      ]}
    >
      {lit && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.playBtnGlow,
            { borderRadius: BTN_RADIUS * scale },
            makeShadow(Colors.goldLit, 0, 0, 0.55, BTN_GLOW * scale, 0),
            glowStyle,
          ]}
        />
      )}
      <Pressable
        testID="btn-gioca"
        onPress={onPress}
        onPressIn={() => setPress(true)}
        onPressOut={() => setPress(false)}
        style={[styles.actionBtnInner, styles.playBtnFront]}
        accessibilityLabel={
          exchange
            ? exchange.picked
              ? t("exchange.confirmA11yReady", {
                  card: cardSpokenName(exchange.picked, t),
                  name: exchange.toName,
                })
              : t("exchange.confirmA11yWaiting", { name: exchange.toName })
            : a11yLabel
        }
        // No `disabled` state, on either platform: an illegal play is answered
        // with the shake and the spoken reason rather than ignored, so the
        // control is operable and its name is what carries the refusal.
        {...a11yState({ role: "button" })}
      >
        {lit ? (
          <LinearGradient
            colors={pressed ? GIOCA_GRADIENT_PRESSED : GIOCA_GRADIENT}
            locations={GIOCA_GRADIENT_LOCATIONS}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.35, y: 1 }}
            style={[styles.actionBtnFace, styles.playBtnFace, { borderRadius: BTN_RADIUS * scale }]}
          >
            <View pointerEvents="none" style={styles.btnTopHighlight} />
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, styles.btnFlash, flashStyle]}
            />
            <TableText
              {...a11yHidden()}
              style={[
                styles.actionBtnLabel,
                styles.playBtnLabel,
                { fontSize: BTN_LABEL_FS * scale, letterSpacing: BTN_TRACKING * scale },
              ]}
            >
              {label}
            </TableText>
            {selectedCount > 1 && (
              <TableText {...a11yHidden()} style={[styles.playBtnSub, { fontSize: BTN_SUB_FS * scale }]}>
                {t("gameTable.selectedCountSuffix", { n: selectedCount })}
              </TableText>
            )}
          </LinearGradient>
        ) : (
          <View
            style={[
              styles.actionBtnFace,
              styles.btnDimFace,
              { borderRadius: BTN_RADIUS * scale },
            ]}
          >
            <TableText
              {...a11yHidden()}
              style={[
                styles.actionBtnLabel,
                styles.btnDimLabel,
                { fontSize: BTN_LABEL_FS * scale, letterSpacing: BTN_TRACKING * scale },
              ]}
            >
              {label}
            </TableText>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function PassaButton({
  canPass,
  flashStyle,
  onPress,
  a11yLabel,
  size,
  scale,
}: {
  canPass: boolean;
  flashStyle: AnimatedStyle<ViewStyle>;
  onPress: () => void;
  a11yLabel: string;
  /** The button is square, and never smaller than a comfortable thumb. */
  size: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const [pressed, setPressed] = useState(false);
  const pressVal = useSharedValue(0);

  // Must precede the effect that reads `pressVal` — the React Compiler skips any component that mutates a value an effect captured.
  const setPress = (down: boolean) => {
    if (!canPass) return;
    setPressed(down);
    pressVal.value = reduceMotion
      ? down ? 1 : 0
      : withTiming(down ? 1 : 0, { duration: Motion.duration.tap });
  };

  useEffect(() => () => cancelAnimation(pressVal), [pressVal]);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressVal.value * (1 - BTN_PRESS_SCALE) }],
  }));

  return (
    <Animated.View
      testID="btn-passa-box"
      style={[
        styles.actionBtn,
        { width: size, height: size, borderRadius: BTN_RADIUS * scale },
        pressStyle,
      ]}
    >
      <Pressable
        testID="btn-passa"
        onPress={onPress}
        onPressIn={() => setPress(true)}
        onPressOut={() => setPress(false)}
        disabled={!canPass}
        style={[styles.actionBtnInner, { borderRadius: BTN_RADIUS * scale, overflow: "hidden" }]}
        accessibilityLabel={a11yLabel}
        {...a11yState({ role: "button", disabled: !canPass })}
      >
        {canPass ? (
          <>
            <LinearGradient
              colors={pressed ? PASS_GRADIENT_PRESSED : PASS_GRADIENT}
              locations={PASS_GRADIENT_LOCATIONS}
              style={StyleSheet.absoluteFill}
            />
            <View pointerEvents="none" style={styles.btnTopHighlight} />
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, styles.btnFlash, flashStyle]}
            />
          </>
        ) : (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.btnDimFace]} />
        )}
        <View style={styles.actionBtnFace}>
          <TableText
            {...a11yHidden()}
            style={[
              styles.actionBtnLabel,
              canPass ? styles.passBtnLabel : styles.btnDimLabel,
              { fontSize: BTN_LABEL_FS * scale, letterSpacing: BTN_TRACKING * scale },
            ]}
          >
            {t("gameTable.passLabel")}
          </TableText>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // overflow stays visible here — the seated shadow lives on this view, and a
  // native shadow is clipped by its own view's bounds. Corner-clipping the
  // gradient happens one level in, on the face.
  actionBtn: { ...Shadow.dark },
  // Off the viewer's turn a key is dark rather than a faded version of its lit
  // self: the prototype's resting `.btn` (#199) is its own ink at a third over
  // a third of black, with no gradient and no border behind it to fight.
  btnDimFace: { backgroundColor: "rgba(0,0,0,0.3)" },
  btnDimLabel: { color: "rgba(239,234,219,0.3)" },
  actionBtnInner: { flex: 1 },
  actionBtnFace: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xxs,
    overflow: "hidden",
  },
  // Tracking is `.16em` in the prototype, so it rides the font size and every
  // caller sets it beside `fontSize`.
  actionBtnLabel: {
    fontFamily: "Rajdhani_700Bold",
    textTransform: "uppercase",
  },
  btnTopHighlight: TopEdgeLight,
  // Sits behind the label, never over it: a wash on top of text would eat the
  // very contrast the flash is meant to draw attention to.
  btnFlash: { backgroundColor: Highlight.clear },
  passBtnLabel: { color: Garnet.label },

  // The armed bloom, as a childless sibling behind the button: the glow is
  // fixed and only this view's opacity is animated. The fill is what the
  // shadow is cast from — a layer with transparent contents has nothing for
  // iOS to blur and gives Android's elevation no outline — and the button's
  // own gradient covers it exactly, so only the spill is ever seen.
  playBtnGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.gold,
    zIndex: Layer.felt,
  },
  // The one lit object on the table, and only on the player's own turn.
  playBtnFace: { borderWidth: 1, borderColor: Colors.goldLit },
  // Over the glow, which fills this button and paints.
  playBtnFront: { zIndex: Layer.table },
  playBtnLabel: { color: Colors.bgCard },
  playBtnSub: {
    fontFamily: "Rajdhani_500Medium",
    color: Colors.bgCard, opacity: 0.7,
  },
});
