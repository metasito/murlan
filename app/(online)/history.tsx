// Every hand the player still has, a page at a time.
//
// Paging is client-side: `match_history` is capped at
// MAX_HISTORY_ROWS_PER_USER per account, and the profile already fetches every
// row for its trend panels, so this screen pages over a list it is holding
// anyway.
import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { MenuLayout } from "@/components/MenuLayout";
import { ScreenHeader } from "@/components/ScreenHeader";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { LoadingBlock, ErrorBlock, EmptyBlock } from "@/components/StateBlock";
import { HistoryRow } from "@/components/HistoryRow";
import { Colors, Spacing, Type } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import type { MatchHistoryDto } from "@/lib/wire";

/** Rows per page. Chosen to fill a phone in portrait without spilling. */
const PAGE_SIZE = 10;

export default function HistoryScreen() {
  const { t } = useTranslation();
  const historyQuery = useQuery<MatchHistoryDto[]>({ queryKey: ["/api/stats/history"] });
  const history = historyQuery.data ?? [];

  const pageCount = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const [page, setPage] = useState(0);
  // Clamped rather than stored safely: a refetch can shrink the list under a
  // page the reader is already on, and an out-of-range page renders empty.
  const current = Math.min(page, pageCount - 1);
  const rows = history.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const pageLabel = t("history.pageLabel", { page: current + 1, total: pageCount });

  return (
    <MenuLayout scrollable centered={false}>
      <ScreenHeader title={t("history.title")} />

      <MenuCard grow>
        {historyQuery.isLoading && <LoadingBlock label={t("history.loadingA11yLabel")} />}

        {historyQuery.isError && (
          <ErrorBlock
            title={t("history.errorTitle")}
            retry={{ label: t("common.retry"), a11yLabel: t("history.retryA11yLabel"), onPress: () => historyQuery.refetch() }}
          />
        )}

        {historyQuery.isSuccess && history.length === 0 && (
          <EmptyBlock
            icon="time-outline"
            title={t("history.emptyTitle")}
            body={t("history.emptyBody")}
          />
        )}

        {rows.length > 0 && (
          <View style={styles.list}>
            {rows.map((h) => (
              <HistoryRow key={h.id} hand={h} />
            ))}
          </View>
        )}

        {/* A single page needs no controls: there is nowhere else to go. */}
        {pageCount > 1 && (
          <View style={styles.pager}>
            <MenuButton
              label={t("history.prev")}
              onPress={() => setPage(current - 1)}
              disabled={current === 0}
              variant="secondary"
              size="sm"
              fullWidth={false}
              accessibilityLabel={t("history.prevA11yLabel")}
            />
            <Text style={styles.pageText} accessibilityRole="text">
              {pageLabel}
            </Text>
            <MenuButton
              label={t("history.next")}
              onPress={() => setPage(current + 1)}
              disabled={current >= pageCount - 1}
              variant="secondary"
              size="sm"
              fullWidth={false}
              accessibilityLabel={t("history.nextA11yLabel")}
            />
          </View>
        )}
      </MenuCard>
    </MenuLayout>
  );
}

const styles = StyleSheet.create({
  // Balances the back button so the title sits centred on the bar.
  list: { gap: Spacing.sm },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    paddingTop: Spacing.md,
  },
  pageText: { ...Type.label, color: Colors.textSecondary },
});
