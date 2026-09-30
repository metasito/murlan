import { useTranslation } from "@/lib/i18n";
import { NoticeGlyph, NoticeText, TableNotice } from "../TableNotice";

export function WaitingLine({ scale }: { scale: number }) {
  const { t } = useTranslation();
  return (
    <TableNotice kind="waitingOthers" tone="gold" scale={scale}>
      <NoticeGlyph name="trophy" px={12} />
      <NoticeText>{t("gameTable.waitingOthers")}</NoticeText>
    </TableNotice>
  );
}

export function EmptyHandLine({ scale }: { scale: number }) {
  const { t } = useTranslation();
  return (
    <TableNotice kind="emptyHand" tone="gold" scale={scale}>
      <NoticeGlyph name="checkmark-circle" px={13} />
      <NoticeText>{t("gameShared.emptyHand")}</NoticeText>
    </TableNotice>
  );
}
