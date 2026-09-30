import { StyleSheet, View } from "react-native";
import { Layer } from "@/lib/theme";
import { A11yStatus, a11yHidden } from "@/lib/a11y";
import { NoticeText, TableNotice } from "../TableNotice";
import { mockupPx } from "../noticeModel";

/** Any width past the widest float: the slot only centres it. */
const FLOAT_SLOT = 240;

export type Float = { id: number; text: string };

export function PassFloat({ text, scale }: { text: string; scale: number }) {
  return (
    <TableNotice kind="passFloat" tone="neutral" scale={scale}>
      <NoticeText>{text}</NoticeText>
    </TableNotice>
  );
}

/**
 * The table's one float, `at` its centre x and top edge. A new `id` replaces the float standing and
 * starts its own life, which ends on the UI thread; the live region outlives every float, so each
 * arrives as a change of text rather than as a node.
 */
export function FloatSlot({ float, at, scale, veiled }: { float: Float | null; at: { x: number; y: number }; scale: number; veiled: boolean }) {
  const slot = mockupPx(FLOAT_SLOT, scale);
  return (
    <>
      <A11yStatus label={float?.text ?? ""} veiled={veiled} />
      {float && (
        <View pointerEvents="none" {...a11yHidden()} style={[styles.slot, { width: slot, left: at.x - slot / 2, top: at.y }]}>
          <PassFloat key={float.id} text={float.text} scale={scale} />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  slot: { position: "absolute", alignItems: "center", zIndex: Layer.moment },
});
