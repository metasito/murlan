import { NoticeIcon, NoticeText, TableNotice } from "../TableNotice";

/** The combination on top of the pile, named: one mark for every combination (#1259 Q5). */
export function ComboMark({ label, scale }: { label: string; scale: number }) {
  return (
    <TableNotice kind="combo" tone="lit" scale={scale}>
      <NoticeText>{label}</NoticeText>
    </TableNotice>
  );
}

/** The seat that took the round, over the pile. */
export function RoundWinnerMark({ name, scale }: { name: string; scale: number }) {
  return (
    <TableNotice kind="roundWinner" tone="lit" scale={scale}>
      <NoticeIcon name="star" />
      <NoticeText>{name}</NoticeText>
    </TableNotice>
  );
}

/** The exchange's who gives what to whom, under the card resting there: the leg's own clock times it. */
export function PileLabelMark({ text, testID, scale }: { text: string; testID: string; scale: number }) {
  return (
    <TableNotice kind="pileLabel" tone="lit" scale={scale} still>
      <NoticeText testID={testID}>{text}</NoticeText>
    </TableNotice>
  );
}
