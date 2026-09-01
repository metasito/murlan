// Every hand the player still has, a page at a time.
//
// Paging is client-side: `match_history` is capped at
// MAX_HISTORY_ROWS_PER_USER per account, and the profile already fetches every
// row for its trend panels, so this screen pages over a list it is holding
// anyway.
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { HistoryRow, type MatchHistoryDto } from "@/components/HistoryRow";
import { Colors, FontSize, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { a11yGroup, a11yHidden } from "@/lib/a11y";

/** Rows per page. Chosen to fill a phone in portrait without spilling. */
const PAGE_SIZE = 10;
const BACK_CHEVRON = 22;
const STATE_ICON = 28;
const RETRY_ICON = 16;

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
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={BACK_CHEVRON} color={Colors.gold} {...a11yHidden()} />
        </Pressable>
        <Text style={styles.screenTitle}>{t("history.title")}</Text>
        <View style={styles.topBarSpacer} />
      </View>

      <MenuCard grow>
        {historyQuery.isLoading && (
          <View style={styles.stateBlock}>
            <ActivityIndicator color={Colors.gold} accessibilityLabel={t("history.loadingA11yLabel")} />
          </View>
        )}

        {historyQuery.isError && (
          <View style={styles.stateBlock}>
            <Ionicons name="alert-circle-outline" size={STATE_ICON} color={Colors.textMuted} {...a11yHidden()} />
            <Text style={styles.stateTitle}>{t("history.errorTitle")}</Text>
            <MenuButton
              label={t("common.retry")}
              onPress={() => historyQuery.refetch()}
              variant="secondary"
              size="sm"
              fullWidth={false}
              accessibilityLabel={t("profile.retryHistoryA11yLabel")}
              icon={<Ionicons name="refresh" size={RETRY_ICON} color={Colors.gold} />}
            />
          </View>
        )}

        {historyQuery.isSuccess && history.length === 0 && (
          <View
            style={styles.stateBlock}
            {...a11yGroup(`${t("profile.historyEmptyTitle")}. ${t("profile.historyEmptyBody")}`)}
          >
            <Ionicons name="time-outline" size={STATE_ICON} color={Colors.textMuted} {...a11yHidden()} />
            <Text style={styles.stateTitle} {...a11yHidden()}>{t("profile.historyEmptyTitle")}</Text>
            <Text style={styles.stateBody} {...a11yHidden()}>{t("profile.historyEmptyBody")}</Text>
          </View>
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    paddingBottom: Spacing.sm,
    marginBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
  // Balances the back button so the title sits centred on the bar.
  topBarSpacer: { width: TOUCH_TARGET_MIN },
  screenTitle: {
    flex: 1,
    textAlign: "center",
    ...Type.heading,
    fontSize: FontSize.xl,
    letterSpacing: 3,
  },
  stateBlock: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.lg },
  stateTitle: { ...Type.subheading },
  stateBody: { ...Type.caption, textAlign: "center" },
  list: { gap: Spacing.sm },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    paddingTop: Spacing.md,
  },
  pageText: { ...Type.label, color: Colors.textSecondary },
  countText: { ...Type.caption, textAlign: "center", paddingTop: Spacing.xs },
});
