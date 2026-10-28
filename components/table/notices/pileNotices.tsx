import { NoticeIcon, NoticeText, TableNotice } from "../TableNotice";

/** The seat that took the trick, over the pile. */
export function TrickWinnerMark({ name, scale }: { name: string; scale: number }) {
  return (
    <TableNotice kind="trickWinner" tone="lit" scale={scale}>
      <NoticeIcon name="star" />
      <NoticeText>{name}</NoticeText>
    </TableNotice>
  );
}
