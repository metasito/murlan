import { useTranslation } from "@/lib/i18n";
import { NoticeText, TableNotice } from "../TableNotice";

/**
 * The name run, capped so a long username ellipsizes rather than pushing the
 * band wider than the felt has room for.
 */
const HUD_NAME_MAX_W = 88;

export function HudComboPill({ scale, play }: { scale: number; play: { name: string; combo: string } | null }) {
  const { t } = useTranslation();
  return (
    <TableNotice kind="hudCombo" tone="neutral" scale={scale}>
      {play === null ? (
        <NoticeText>{t("gameShared.emptyTable")}</NoticeText>
      ) : (
        <>
          <NoticeText maxWidth={HUD_NAME_MAX_W}>{play.name}</NoticeText>
          <NoticeText strong>{play.combo}</NoticeText>
        </>
      )}
    </TableNotice>
  );
}
