// The rail's settings sheet — focus mode, the mid-manche subset of sound,
// music and vibration, the left-handed swap, and the exit flow. Anchored
// beside the rail rather than as a React Native Modal: the rail's own menu
// knob has to stay tappable to close it, and a full-screen modal would take
// the tap away from it along with everything else.

import { useEffect, type ComponentProps } from "react";
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { SlideInLeft } from "react-native-reanimated";
import Feather from "@expo/vector-icons/Feather";
import { RAIL_TESTID } from "./chrome";
import { physicalTouchTarget } from "@/components/cardFaceModel";
import { TableText } from "./TableText";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, FontSize, Garnet, Highlight, makeShadow, Motion, Scrim, Spacing, TOUCH_TARGET_MIN } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import { useSettings } from "@/context/SettingsContext";
import { a11yDialog, a11yHidden, a11yState, useA11yHint, useFocusTrap } from "@/lib/a11y";

const SHEET_TESTID = "settings-sheet";

/**
 * Closes on Escape, but only when nothing sits above the sheet already — a
 * react-native-web Modal (the exit confirmation) wires its own Escape
 * handler onto itself while `active`, and both listeners otherwise fire on
 * the same keypress, closing the confirmation *and* the sheet behind it in
 * one tap of a key the player only meant for the dialog on top.
 */
function useEscapeToClose(onEscape: () => void) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      onEscape();
    };
    document.addEventListener("keyup", handler);
    return () => document.removeEventListener("keyup", handler);
  }, [onEscape]);
}

/**
 * Android's back gesture is the system's own "dismiss what is on top", which a
 * React Native Modal answers for free. This sheet is not one, so unanswered the
 * gesture reaches the router and pops the whole game screen out from behind a
 * sheet the player only meant to close.
 */
function useBackToClose(onBack: () => void) {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);
}

const SWITCH_W = 34;
const SWITCH_H = 19;
const SWITCH_THUMB = 13;
const SWITCH_INSET = 3;

function RowSwitch({ on, scale }: { on: boolean; scale: number }) {
  const w = SWITCH_W * scale;
  const h = SWITCH_H * scale;
  const thumb = SWITCH_THUMB * scale;
  const inset = SWITCH_INSET * scale;
  const travel = w - thumb - inset * 2;
  return (
    <View
      {...a11yHidden()}
      style={[
        sheetStyles.switchTrack,
        { width: w, height: h, borderRadius: h / 2, borderWidth: StyleSheet.hairlineWidth },
        on ? sheetStyles.switchTrackOn : sheetStyles.switchTrackOff,
      ]}
    >
      <View
        style={[
          sheetStyles.switchThumb,
          {
            width: thumb,
            height: thumb,
            borderRadius: thumb / 2,
            top: (h - thumb) / 2,
            left: inset,
            transform: [{ translateX: on ? travel : 0 }],
          },
          on ? sheetStyles.switchThumbOn : sheetStyles.switchThumbOff,
        ]}
      />
    </View>
  );
}

const ROW_RADIUS = 8;
const ROW_PAD_H = 7;
const ROW_FS = 12.5;
const ROW_HINT_FS = 9.5;
const ROW_TRACKING = 0.7;
const ROW_ICON_FS = 16;
// Wider than the widest glyph, so the labels start at one x rather than at
// each icon's own advance.
const ROW_ICON_GUTTER = 20;

function SheetRow({
  label,
  icon,
  hint,
  a11yLabel,
  a11yHint,
  on,
  onToggle,
  scale,
}: {
  label: string;
  icon: ComponentProps<typeof Feather>["name"];
  /** A second line under the label — visible, not a screen-reader-only hint. */
  hint?: string;
  /** When the row's own word is too terse spoken aloud — "Sounds" alone. */
  a11yLabel?: string;
  a11yHint?: string;
  on: boolean;
  onToggle: () => void;
  scale: number;
}) {
  const a11y = useA11yHint(a11yHint);
  return (
    <>
      <Pressable
        testID={`settings-row-${label}`}
        onPress={onToggle}
        accessibilityLabel={a11yLabel ?? label}
        {...a11yState({ role: "switch", checked: on })}
        {...a11y.props}
        style={({ pressed }) => [
          sheetStyles.row,
          { borderRadius: ROW_RADIUS * scale, paddingHorizontal: ROW_PAD_H * scale },
          pressed && sheetStyles.rowPressed,
        ]}
      >
        <View style={sheetStyles.rowLeft} {...a11yHidden()}>
          <Feather
            name={icon}
            size={ROW_ICON_FS * scale}
            color={Colors.textSecondary}
            style={{ width: ROW_ICON_GUTTER * scale, textAlign: "center" }}
          />
          <View style={sheetStyles.rowLabels}>
            <TableText
              numberOfLines={1}
              style={[sheetStyles.rowLabel, { fontSize: ROW_FS * scale, letterSpacing: ROW_TRACKING * scale }]}
            >
              {label}
            </TableText>
            {hint && (
              <TableText numberOfLines={1} style={[sheetStyles.rowHint, { fontSize: ROW_HINT_FS * scale }]}>
                {hint}
              </TableText>
            )}
          </View>
        </View>
        <RowSwitch on={on} scale={scale} />
      </Pressable>
      {a11y.node}
    </>
  );
}

const SHEET_W = 212;
const SHEET_RADIUS = 14;
const SHEET_PAD = 9;
const SHEET_PAD_H = 12;
const SHEET_SHADOW = 34;
const SHEET_SHADOW_Y = 12;
const HEADER_FS = 10;
const HEADER_TRACKING = 2.2;
const DIVIDER_MARGIN_V = 5;
const EXIT_RADIUS = 9;
const EXIT_PAD_V = 10;
const EXIT_FS = 12.5;
const EXIT_TRACKING = 2.25;
const FOOT_FS = 9.5;
const FOOT_MARGIN = 5;
const ROW_GAP = 2;
/** How much of the row list's own foot fades to nothing, the scroll affordance
 * that stands in for a scrollbar the sheet never shows. */
const ROWS_FADE_H = 14;

// The prototype's own gradient — deep enough behind the felt's own greens
// that no card back or table felt reads as part of it, which is the whole
// reason those pickers stay out of this sheet.
const SHEET_GRADIENT = ["rgba(4,18,12,0.93)", "rgba(1,8,5,0.96)"] as const;
// The fade overlay paints the sheet's own last gradient stop over the rows
// it covers, rather than a true alpha mask — React Native has no CSS `mask`
// on either platform, and a gradient into the panel's own colour reads the
// same wherever a fixed length of rows happens to end.
const ROWS_FADE_GRADIENT = ["rgba(1,8,5,0)", "rgba(1,8,5,0.96)"] as const;
const EXIT_GRADIENT = [Garnet.lip, Garnet.face, Garnet.deep, Garnet.base] as const;
const EXIT_GRADIENT_LOCATIONS = [0, 0.22, 0.6, 1] as const;

export interface GameSettingsSheetProps {
  /** The rail's own width — the sheet and its veil both start at its outer edge. */
  rail: number;
  topPad: number;
  bottomPad: number;
  scale: number;
  /** The rail's menu knob closes the sheet too; this is every other way out. */
  onClose: () => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  playOnLeft: boolean;
  onTogglePlayOnLeft: () => void;
  onExit: () => void;
}

/** Above the felt, the seats and the HUD chips; below the exit confirmation, which is a real Modal. */
const SHEET_Z = 60;

export function GameSettingsSheet({
  rail,
  topPad,
  bottomPad,
  scale,
  onClose,
  focusMode,
  onToggleFocusMode,
  playOnLeft,
  onTogglePlayOnLeft,
  onExit,
}: GameSettingsSheetProps) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  // The persisted three come from the same context `SettingsModal` reads, and
  // they are read here rather than in `GameTable` so that only the sheet — a
  // subtree that exists solely while the player has it open — depends on the
  // provider being mounted above it.
  const {
    soundsEnabled,
    setSoundsEnabled,
    musicEnabled,
    setMusicEnabled,
    hapticsEnabled,
    setHapticsEnabled,
  } = useSettings();
  useEscapeToClose(onClose);
  useBackToClose(onClose);
  // The veil covers pixels and nothing else, so without this the hand, PASSA
  // and GIOCA all stay in the tab order behind it.
  useFocusTrap([SHEET_TESTID, RAIL_TESTID]);

  return (
    <>
      {/* Starts at the rail's own outer edge, never under it — the menu knob
          that opened this has to stay reachable to close it again. */}
      <Pressable
        testID="settings-veil"
        onPress={onClose}
        {...a11yHidden()}
        style={[sheetStyles.veil, { left: rail, zIndex: SHEET_Z }]}
      />
      <Animated.View
        testID={SHEET_TESTID}
        {...a11yDialog(t("gameSettingsSheet.title"))}
        entering={reduceMotion ? undefined : SlideInLeft.duration(Motion.duration.base)}
        style={[
          sheetStyles.sheetPos,
          { left: rail, top: topPad, bottom: bottomPad, width: SHEET_W * scale, zIndex: SHEET_Z + 1 },
        ]}
      >
        <LinearGradient
          colors={SHEET_GRADIENT}
          style={[
            sheetStyles.sheet,
            {
              borderRadius: SHEET_RADIUS * scale,
              padding: SHEET_PAD * scale,
              paddingHorizontal: SHEET_PAD_H * scale,
            },
            makeShadow(Colors.shadow, 0, SHEET_SHADOW_Y * scale, 0.6, SHEET_SHADOW * scale, 12),
          ]}
        >
          <TableText style={[sheetStyles.header, { fontSize: HEADER_FS * scale, letterSpacing: HEADER_TRACKING * scale }]}>
            {t("gameSettingsSheet.title")}
          </TableText>

          {/* flex: 1 is what makes the list fit without scrolling when the
              rows leave room and scroll cleanly when they don't — the sheet's
              own height is fixed by `top`/`bottom`, so this is the only part
              of it free to give. */}
          <View style={sheetStyles.rowsWrap}>
            <ScrollView
              testID="settings-rows"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: ROW_GAP * scale }}
            >
              <SheetRow
                label={t("settings.sounds")}
                icon={soundsEnabled ? "volume-2" : "volume-x"}
                a11yLabel={t("settings.soundsA11yLabel")}
                a11yHint={t("settings.soundsA11yHint")}
                on={soundsEnabled}
                onToggle={() => setSoundsEnabled(!soundsEnabled)}
                scale={scale}
              />
              <SheetRow
                label={t("settings.music")}
                icon="music"
                a11yLabel={t("settings.musicA11yLabel")}
                a11yHint={t("settings.musicA11yHint")}
                on={musicEnabled}
                onToggle={() => setMusicEnabled(!musicEnabled)}
                scale={scale}
              />
              {Platform.OS !== "web" && (
                <SheetRow
                  label={t("settings.haptics")}
                  icon="smartphone"
                  a11yLabel={t("settings.hapticsA11yLabel")}
                  a11yHint={t("settings.hapticsA11yHint")}
                  on={hapticsEnabled}
                  onToggle={() => setHapticsEnabled(!hapticsEnabled)}
                  scale={scale}
                />
              )}
              <SheetRow
                label={t("gameSettingsSheet.focusMode")}
                icon="eye"
                hint={t("gameSettingsSheet.focusModeHint")}
                a11yHint={t("gameSettingsSheet.focusModeA11yHint")}
                on={focusMode}
                onToggle={onToggleFocusMode}
                scale={scale}
              />
              <SheetRow
                label={t("gameSettingsSheet.playOnLeft")}
                icon="corner-down-left"
                hint={t("gameSettingsSheet.playOnLeftHint")}
                a11yHint={t("gameSettingsSheet.playOnLeftA11yHint")}
                on={playOnLeft}
                onToggle={onTogglePlayOnLeft}
                scale={scale}
              />
            </ScrollView>
            <LinearGradient
              pointerEvents="none"
              colors={ROWS_FADE_GRADIENT}
              style={[sheetStyles.rowsFade, { height: ROWS_FADE_H * scale }]}
            />
          </View>

          <View style={[sheetStyles.divider, { marginVertical: DIVIDER_MARGIN_V * scale }]} />

          <Pressable
            testID="settings-exit"
            onPress={onExit}
            accessibilityRole="button"
            accessibilityLabel={t("gameSettingsSheet.exit")}
            style={({ pressed }) => [pressed && sheetStyles.exitPressed]}
          >
            <LinearGradient
              colors={EXIT_GRADIENT}
              locations={EXIT_GRADIENT_LOCATIONS}
              style={[
                sheetStyles.exit,
                {
                  borderRadius: EXIT_RADIUS * scale,
                  paddingVertical: EXIT_PAD_V * scale,
                  // Padding around a scaled label put this at ~29pt on an iPhone SE. The
                  // floor is physical, never `TOUCH_TARGET_MIN * scale`; the rows list
                  // above is the part of the sheet free to give, and it scrolls.
                  minHeight: physicalTouchTarget(scale),
                },
              ]}
            >
              <TableText
                {...a11yHidden()}
                style={[sheetStyles.exitLabel, { fontSize: EXIT_FS * scale, letterSpacing: EXIT_TRACKING * scale }]}
              >
                {t("gameSettingsSheet.exit")}
              </TableText>
            </LinearGradient>
          </Pressable>

          <TableText style={[sheetStyles.foot, { fontSize: FOOT_FS * scale, marginTop: FOOT_MARGIN * scale }]}>
            {t("gameSettingsSheet.footnote")}
          </TableText>
        </LinearGradient>
      </Animated.View>
    </>
  );
}

const sheetStyles = StyleSheet.create({
  veil: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: Scrim.medium,
  },
  sheetPos: { position: "absolute" },
  sheet: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
  },
  header: {
    fontFamily: "Rajdhani_600SemiBold",
    color: Colors.gold,
    textTransform: "uppercase",
    marginBottom: Spacing.xs,
  },
  rowsWrap: { flex: 1 },
  rowsFade: { position: "absolute", left: 0, right: 0, bottom: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.snug,
    minHeight: TOUCH_TARGET_MIN,
  },
  rowPressed: { backgroundColor: Colors.goldGhost },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: Spacing.slim, flexShrink: 1 },
  rowLabels: { flexShrink: 1 },
  rowLabel: {
    fontFamily: "Rajdhani_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase",
  },
  rowHint: {
    fontFamily: "Rajdhani_500Medium",
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  switchTrack: { justifyContent: "center" },
  switchTrackOff: { backgroundColor: Highlight.soft, borderColor: Colors.goldSoft },
  switchTrackOn: { backgroundColor: Colors.goldBorder, borderColor: Colors.goldLit },
  switchThumb: { position: "absolute" },
  switchThumbOff: { backgroundColor: Colors.textMuted },
  switchThumbOn: { backgroundColor: Colors.goldLit },
  divider: { height: 1, backgroundColor: Colors.goldBorder },
  exit: { alignItems: "center", justifyContent: "center" },
  exitPressed: { opacity: 0.88 },
  exitLabel: {
    fontFamily: "Rajdhani_700Bold",
    color: Garnet.label,
    textTransform: "uppercase",
  },
  foot: {
    fontFamily: "Rajdhani_500Medium",
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: FontSize.sm,
  },
});
