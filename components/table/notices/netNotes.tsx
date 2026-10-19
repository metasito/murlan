import { Pressable, StyleSheet, View } from "react-native";
import { A11yStatus, a11yHidden, a11yState, useA11yHint } from "@/lib/a11y";
import { useTranslation } from "@/lib/i18n";
import { TOUCH_TARGET_MIN } from "@/lib/theme";
import { BoardButton } from "../matchBoard";
import { NoticeBadge, NoticeGlyph, NoticeLine, NoticeText, TableNotice } from "../TableNotice";
import { mockupPx, noticeBox, panelParts, type NoticeKind } from "../noticeModel";

export type EndMatchVoteNote = { voted: boolean; votes: number; total: number; onPress: () => void };
export type RoundVoteNote = EndMatchVoteNote & { deadline?: { seconds: number; resetKey: string } };
export type LeftTableNote = { onReclaim: () => void; onLeave: () => void };

/** The viewer's own seat went to a bot at the vote deadline: why, and the two ways on from there. */
export function LeftTable({ scale, onReclaim, onLeave }: LeftTableNote & { scale: number }) {
  const { t } = useTranslation();
  const part = panelParts(scale);
  const u = mockupPx(1, scale);
  const title = t("onlineGame.leftTableTitle");
  const body = t("onlineGame.leftTableBody");
  return (
    <View style={[styles.leftTable, { gap: part.rowGap }]}>
      <A11yStatus label={`${title}. ${body}`} role="alert" live="assertive" />
      <View {...a11yHidden()}>
        <TableNotice kind="leftTable" tone="neutral" scale={scale}>
          <View style={{ gap: part.subGap }}>
            <NoticeLine line="main">{title}</NoticeLine>
            <NoticeLine line="sub">{body}</NoticeLine>
          </View>
        </TableNotice>
      </View>
      <View style={[styles.actions, { gap: part.rowGap }]}>
        <BoardButton testID="btn-left-table-leave" label={t("onlineGame.leftTableLeave")} onPress={onLeave} unit={u} live />
        <BoardButton
          primary
          testID="btn-left-table-reclaim"
          label={t("onlineGame.leftTableReclaim")}
          onPress={onReclaim}
          unit={u}
          live
        />
      </View>
    </View>
  );
}

/** The pill's own box grown to the floor, its footprint unchanged: react-native-web ignores `hitSlop` on a Pressable. */
function reach(kind: NoticeKind, scale: number) {
  const slop = Math.max(0, (TOUCH_TARGET_MIN - (noticeBox(kind, scale).height ?? 0)) / 2);
  return { paddingVertical: slop, marginVertical: -slop };
}

/** The next-hand vote at the open pill's foot: the tally as a count, lit and spent once the viewer has voted. */
export function RoundVote({ scale, voted, votes, total, onPress }: RoundVoteNote & { scale: number }) {
  const { t } = useTranslation();
  const waiting = t("roundOverOverlay.waitingA11yLabel", { count: votes, total });
  return (
    <>
      <A11yStatus label={voted ? waiting : ""} />
      <Pressable
        style={reach("roundVote", scale)}
        {...a11yState({ role: "button", disabled: voted })}
        accessibilityLabel={voted ? waiting : t("roundOverOverlay.nextRoundA11yLabel")}
        disabled={voted}
        onPress={onPress}
      >
        <View {...a11yHidden()}>
          <TableNotice kind="roundVote" tone={voted ? "lit" : "neutral"} scale={scale}>
            <NoticeGlyph name={voted ? "checkmark-circle" : "play-forward-outline"} px={12} />
            <NoticeText>{voted ? t("roundOverOverlay.nextRoundWaiting", { count: votes, total }) : t("result.nextRound")}</NoticeText>
            {!voted && <NoticeBadge>{`${votes}/${total}`}</NoticeBadge>}
          </TableNotice>
        </View>
      </Pressable>
    </>
  );
}

/** G2's vote: the button's words, the tally as a count, lit once the viewer has voted. */
export function EndMatchVote({ scale, voted, votes, total, onPress }: EndMatchVoteNote & { scale: number }) {
  const { t } = useTranslation();
  const hint = useA11yHint(t("game.endMatchVoteHint"));
  const tally = votes === 0 ? "" : t(voted ? "game.endMatchVoteTallyVoted" : "game.endMatchVoteTally", { votes, total });
  return (
    <>
      <A11yStatus label={tally} />
      <Pressable
        style={reach("endMatchVote", scale)}
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

const styles = StyleSheet.create({
  leftTable: { alignItems: "flex-end" },
  actions: { flexDirection: "row", alignItems: "center" },
});
