// What an on/off switch looks like, with no control of its own.
//
// Two things render it: `components/Toggle.tsx`, which wraps it in its own
// Pressable, and the table's settings sheet, where the whole row is the
// control and the switch is the part of it that moves. Neither may expose an
// accessible node here — the control that owns it is already named.
import React from "react";
import { StyleSheet, View } from "react-native";
import { Colors, Radius } from "@/lib/theme";
import { a11yHidden } from "@/lib/a11y";

/** The menu's size. The table's sheet scales this by its own layout factor. */
const TRACK_W = 52;
const TRACK_H = 32;
const THUMB = 24;

export function SwitchVisual({ on, scale = 1 }: { on: boolean; scale?: number }) {
  const w = TRACK_W * scale;
  const h = TRACK_H * scale;
  const thumb = THUMB * scale;
  const inset = (h - thumb) / 2;
  return (
    <View
      {...a11yHidden()}
      style={[
        styles.track,
        { width: w, height: h, borderRadius: Radius.full },
        on && styles.trackOn,
      ]}
    >
      <View
        style={[
          styles.thumb,
          { width: thumb, height: thumb, borderRadius: Radius.full, top: inset },
          on ? { right: inset, backgroundColor: Colors.white } : { left: inset, backgroundColor: Colors.textMuted },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { justifyContent: "center", backgroundColor: Colors.bgElevated },
  trackOn: { backgroundColor: Colors.gold },
  thumb: { position: "absolute" },
});
