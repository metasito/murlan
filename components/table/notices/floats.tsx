import { StyleSheet, View } from "react-native";
import { Layer } from "@/lib/theme";
import { A11yStatus, a11yHidden } from "@/lib/a11y";
import { NoticeDot, NoticeText, TableNotice } from "../TableNotice";
import { mockupPx } from "../noticeModel";

/** Any width past the widest float, G2's toast: the slot only centres it. */
const FLOAT_SLOT = 440;
/** G2: the reject float's foot over GIOCA's top. */
const ABOVE_GIOCA = 8;

/** `live` while the state that raised it stands: the region's text goes with it, so the next float is a change. */
export type Float = { id: number; kind: "pass" | "reject" | "toast"; text: string; live: boolean };

/** GIOCA's top edge, up from the window's foot, and the table's edges it sits against. */
export type BesideGioca = { giocaTop: number; left: number; right: number; mirrored: boolean };

export function PassFloat({ text, scale }: { text: string; scale: number }) {
  return (
    <TableNotice kind="passFloat" tone="neutral" scale={scale}>
      <NoticeText>{text}</NoticeText>
    </TableNotice>
  );
}

export function RejectFloat({ text, scale, mirrored = false }: { text: string; scale: number; mirrored?: boolean }) {
  return (
    <TableNotice kind="rejectFloat" tone="bad" scale={scale}>
      <NoticeDot />
      <NoticeText align={mirrored ? "left" : "right"}>{text}</NoticeText>
    </TableNotice>
  );
}

export function ErrorToast({ text, scale }: { text: string; scale: number }) {
  return (
    <TableNotice kind="errorToast" tone="bad" scale={scale}>
      <NoticeDot />
      <NoticeText>{text}</NoticeText>
    </TableNotice>
  );
}

/**
 * The table's one float: the pass and the error toast `at` its centre x and top edge, a refused play
 * `beside` GIOCA. A new `id` replaces the float standing and starts its own life, which ends on the UI
 * thread; the live region outlives every float, so each arrives as a change of text rather than as a node.
 */
export function FloatSlot({
  float,
  at,
  beside,
  scale,
  veiled,
}: {
  float: Float | null;
  at: { x: number; y: number };
  beside: BesideGioca;
  scale: number;
  veiled: boolean;
}) {
  const slot = mockupPx(FLOAT_SLOT, scale);
  const place =
    float?.kind === "reject"
      ? [styles.beside, { bottom: beside.giocaTop + mockupPx(ABOVE_GIOCA, scale), left: beside.left, right: beside.right }, beside.mirrored && styles.mirrored]
      : [styles.slot, { width: slot, left: at.x - slot / 2, top: at.y }];
  return (
    <>
      <A11yStatus label={float?.live ? float.text : ""} veiled={veiled} />
      {float && (
        <View pointerEvents="none" {...a11yHidden()} style={place}>
          {float.kind === "reject" ? (
            <RejectFloat key={float.id} text={float.text} scale={scale} mirrored={beside.mirrored} />
          ) : float.kind === "toast" ? (
            <ErrorToast key={float.id} text={float.text} scale={scale} />
          ) : (
            <PassFloat key={float.id} text={float.text} scale={scale} />
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  slot: { position: "absolute", alignItems: "center", zIndex: Layer.moment },
  beside: { position: "absolute", alignItems: "flex-end", zIndex: Layer.hint },
  mirrored: { alignItems: "flex-start" },
});
