import { Pressable, View } from "react-native";
import { A11yStatus, a11yHidden, a11yState, useA11yHint } from "@/lib/a11y";
import { useTranslation } from "@/lib/i18n";
import { Spacing } from "@/lib/theme";
import { NoticeBadge, NoticeGlyph, NoticeText, TableNotice } from "../TableNotice";

export type EndMatchVoteNote = { voted: boolean; votes: number; total: number; onPress: () => void };

/** G2's vote: the button's words, the tally as a count, lit once the viewer has voted. */
export function EndMatchVote({ scale, voted, votes, total, onPress }: EndMatchVoteNote & { scale: number }) {
  const { t } = useTranslation();
  const hint = useA11yHint(t("game.endMatchVoteHint"));
  const tally = votes === 0 ? "" : t(voted ? "game.endMatchVoteTallyVoted" : "game.endMatchVoteTally", { votes, total });
  return (
    <>
      <A11yStatus label={tally} />
      <Pressable
        hitSlop={Spacing.wide}
        {...a11yState({ role: "button", selected: voted })}
        accessibilityLabel={voted ? t("game.endMatchWithdrawButton") : t("game.endMatchVoteButton")}
        {...hint.props}
        onPress={onPress}
      >
        <View {...a11yHidden()}>
          <TableNotice kind="endMatchVote" tone={voted ? "lit" : "neutral"} scale={scale}>
            <NoticeGlyph name={voted ? "flag" : "flag-outline"} px={12} />
            <NoticeText>{t("game.endMatchVoteButton")}</NoticeText>
            {votes > 0 && <NoticeBadge>{`${votes}/${total}`}</NoticeBadge>}
          </TableNotice>
        </View>
        {hint.node}
      </Pressable>
    </>
  );
}
