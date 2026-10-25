import { NoticeIcon, NoticeText, TableNotice } from "../TableNotice";

/** The combination on top of the pile, named: one mark for every combination (#1259 Q5). */
export function ComboMark({ label, scale }: { label: string; scale: number }) {
  return (
    <TableNotice kind="combo" tone="lit" scale={scale}>
      <NoticeText>{label}</NoticeText>
    </TableNotice>
  );
}

/** The seat that took the trick, over the pile. */
export function TrickWinnerMark({ name, scale }: { name: string; scale: number }) {
  return (
    <TableNotice kind="trickWinner" tone="lit" scale={scale}>
      <NoticeIcon name="star" />
      <NoticeText>{name}</NoticeText>
    </TableNotice>
  );
}
