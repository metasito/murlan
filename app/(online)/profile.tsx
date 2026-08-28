import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { Colors, Spacing, Radius, FontSize, Type, Motion, TOUCH_TARGET_MIN } from "@/lib/theme";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import {
  recentForm,
  placementDistribution,
  byPlayerCount,
  RECENT_FORM_LIMIT,
} from "@/lib/profileStats";
import { MenuButton } from "@/components/MenuButton";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey, TranslationParams } from "@/lib/i18n";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import type { GameMode } from "@/lib/gameEngine";
import type { ReplaySummary } from "@/lib/replay";
import { REPLAY_RETENTION_DAYS } from "@/lib/replay";
import { PROVISIONAL_GAMES, formatSeason } from "@/lib/rating";
import { a11yGroup, a11yHidden } from "@/lib/a11y";
import { serverErrorMessage } from "@/lib/apiError";
import { USERNAME_MAX, USERNAME_MIN, usernameProblem } from "@/shared/username";

type TFn = (key: TranslationKey, params?: TranslationParams) => string;
type TnFn = (base: string, count: number, params?: TranslationParams) => string;
type IconName = React.ComponentProps<typeof Ionicons>["name"];

// Wire shapes as they actually arrive over JSON (server/stats.ts) — Date
// columns are serialized to ISO strings, not the `Date` objects that
// shared/schema.ts's UserStats/MatchHistory types (DB row shapes) carry.
interface UserStatsDto {
  userId: string;
  gamesPlayed: number;
  gamesWon: number;
  matchesWon: number;
  currentStreak: number;
  bestStreak: number;
  dailyStreak: number;
  bombsPlayed: number;
  updatedAt: string;
}

interface RatingDto {
  season: string;
  rating: number;
  games: number;
  provisional: boolean;
}

interface MatchHistoryDto {
  id: string;
  userId: string;
  finishedAt: string;
  gameMode: GameMode;
  placement: number;
  playerCount: number;
  points: number;
  opponents: unknown[];
}

interface AchievementStatusDto {
  id: string;
  nameKey: string;
  descKey: string;
  unlocked: boolean;
  unlockedAt: string | null;
}

/** The podium reads the same here as on the result screen. */
const PLACEMENT_COLORS = [
  Colors.podiumGold,
  Colors.podiumSilver,
  Colors.podiumBronze,
  Colors.textMuted,
];
/** The floor a stat tile and an achievement row read at. Neither takes a press. */
const READABLE_ROW_H = 44;
const FORM_KEY_W = 34;
const FORM_VALUE_W = 28;
const placementColor = (placement: number) => PLACEMENT_COLORS[placement - 1] ?? Colors.textMuted;

// Shared with app/result.tsx / components/GameOverOverlay.tsx — same "1°"/
// "2°"/"3°"/"4°" badge text, one source of truth.
const POSITION_LABEL_KEYS: TranslationKey[] = [
  "gameOverOverlay.position1",
  "gameOverOverlay.position2",
  "gameOverOverlay.position3",
  "gameOverOverlay.position4",
];

// Same relative-time phrasing as app/(online)/friends.tsx's `relativeTime` —
// not exported there, so duplicated rather than reaching across a screen
// boundary; the underlying friends.time* keys are generic enough to share.
function relativeTime(isoString: string | null | undefined, t: TFn, tn: TnFn): string {
  if (!isoString) return t("friends.timeUnknown");
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("friends.timeJustNow");
  if (mins < 60) return t("friends.timeMinutesAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return tn("friends.timeHoursAgo", hours);
  const days = Math.floor(hours / 24);
  return tn("friends.timeDaysAgo", days);
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <View style={styles.stateBlock}>
      <ActivityIndicator color={Colors.gold} accessibilityLabel={label} />
    </View>
  );
}

function ErrorBlock({
  title,
  retryLabel,
  retryA11yLabel,
  onRetry,
}: {
  title: string;
  retryLabel: string;
  retryA11yLabel: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.stateBlock}>
      <Ionicons name="alert-circle-outline" size={28} color={Colors.textMuted} />
      <Text style={styles.stateTitle}>{title}</Text>
      <MenuButton
        label={retryLabel}
        onPress={onRetry}
        variant="secondary"
        size="sm"
        fullWidth={false}
        accessibilityLabel={retryA11yLabel}
        icon={<Ionicons name="refresh" size={16} color={Colors.gold} />}
      />
    </View>
  );
}

function EmptyBlock({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <View style={styles.stateBlock} {...a11yGroup(`${title}. ${body}`)}>
      <Ionicons name={icon} size={28} color={Colors.textMuted} {...a11yHidden()} />
      <Text style={styles.stateTitle} {...a11yHidden()}>{title}</Text>
      <Text style={styles.stateBody} {...a11yHidden()}>{body}</Text>
    </View>
  );
}

function StatTile({ icon, value, label }: { icon: IconName; value: string; label: string }) {
  return (
    <View style={styles.statTile} {...a11yGroup(`${label}: ${value}`)}>
      <Ionicons name={icon} size={18} color={Colors.gold} {...a11yHidden()} />
      <Text style={styles.statValue} {...a11yHidden()}>{value}</Text>
      <Text style={styles.statLabel} {...a11yHidden()}>{label}</Text>
    </View>
  );
}

/**
 * The signed-in player, and the one control that changes who they are.
 *
 * `usernameProblem` runs before the request so "too short" and "invalid
 * characters" can be told apart: the server answers both with `INVALID_PAYLOAD`,
 * and it is one rule read twice rather than two rules (`shared/username.ts`).
 */
function UserCard({ user }: { user: { username: string } }) {
  const { t } = useTranslation();
  const { rename } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user.username);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setDraft(user.username);
    setError(null);
    setEditing(true);
  };

  const problemKey: Record<NonNullable<ReturnType<typeof usernameProblem>>, TranslationKey> = {
    tooShort: "profile.renameTooShort",
    tooLong: "profile.renameTooLong",
    invalidChars: "profile.renameInvalidChars",
  };

  async function save() {
    const name = draft.trim();
    if (name === user.username) {
      setEditing(false);
      return;
    }
    const problem = usernameProblem(name);
    if (problem) {
      setError(t(problemKey[problem], { min: USERNAME_MIN, max: USERNAME_MAX }));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await rename(name);
      // The ladder is the only cached list that carries the viewer's own name —
      // friends and requests carry other people's, and home reads the account
      // straight from AuthContext.
      queryClient.invalidateQueries({ queryKey: ["/api/ratings/leaderboard"] });
      setEditing(false);
    } catch (e: unknown) {
      setError(serverErrorMessage(e, t("profile.renameFailed")));
    }
    setSaving(false);
  }

  if (!editing) {
    return (
      <View style={styles.userCard}>
        <View
          style={styles.userIdentity}
          {...a11yGroup(t("profile.loggedInAs", { username: user.username }))}
        >
          <View style={styles.avatar} {...a11yHidden()}>
            <Text style={styles.avatarText}>{user.username.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.username} numberOfLines={1} {...a11yHidden()}>
            {user.username}
          </Text>
        </View>
        <Pressable
          onPress={open}
          style={styles.renameBtn}
          accessibilityRole="button"
          accessibilityLabel={t("profile.renameA11yLabel")}
          hitSlop={12}
          testID="btn-rename"
        >
          <Ionicons name="pencil" size={18} color={Colors.gold} {...a11yHidden()} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.renameCard}>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.renameInput}
          value={draft}
          onChangeText={(v) => {
            setDraft(v);
            setError(null);
          }}
          placeholder={t("profile.renamePlaceholder")}
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          maxLength={USERNAME_MAX}
          returnKeyType="done"
          onSubmitEditing={save}
          editable={!saving}
          accessibilityLabel={t("profile.renameA11yLabel")}
          testID="input-rename"
        />
      </View>

      {error && (
        <Text style={styles.renameError} testID="rename-error">
          {error}
        </Text>
      )}

      <View style={styles.renameActions}>
        <MenuButton
          label={t("common.cancel")}
          variant="ghost"
          onPress={() => setEditing(false)}
          disabled={saving}
        />
        <MenuButton
          label={saving ? t("profile.renameSaving") : t("common.save")}
          onPress={save}
          disabled={saving}
        />
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { t, tn } = useTranslation();
  const { user } = useAuth();
  const reduceMotion = usePrefersReducedMotion();

  const statsQuery = useQuery<UserStatsDto>({ queryKey: ["/api/stats/me"] });
  const historyQuery = useQuery<MatchHistoryDto[]>({ queryKey: ["/api/stats/history"] });
  const achievementsQuery = useQuery<AchievementStatusDto[]>({ queryKey: ["/api/stats/achievements"] });
  const replaysQuery = useQuery<ReplaySummary[]>({ queryKey: ["/api/replays"] });
  const ratingQuery = useQuery<RatingDto>({ queryKey: ["/api/ratings/me"] });

  const stats = statsQuery.data;
  const history = historyQuery.data ?? [];
  const achievements = achievementsQuery.data ?? [];
  const replays = replaysQuery.data ?? [];
  const rating = ratingQuery.data;
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const winRate = stats && stats.gamesPlayed > 0 ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0;

  const achievementsTitle = achievementsQuery.isSuccess
    ? `${t("profile.achievementsTitle")} · ${unlockedCount}/${achievements.length}`
    : t("profile.achievementsTitle");

  const entering = reduceMotion ? undefined : FadeIn.duration(Motion.duration.travel);

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
          <Ionicons name="chevron-back" size={22} color={Colors.gold} {...a11yHidden()} />
        </Pressable>
        <Text style={styles.screenTitle}>{t("profile.title")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.contentWrapper}>
        {user && <UserCard user={user} />}

        {/* ── Classifica ── */}
        {/* Ahead of Statistiche: it's the one card whose control (open the
            ladder) is useful before a player has any stats to show. */}
          <Animated.View entering={entering}>
            <MenuCard title={t("ladder.cardTitle")}>
              {ratingQuery.isLoading && <LoadingBlock label={t("ladder.loadingA11yLabel")} />}
              {ratingQuery.isError && (
                <ErrorBlock
                  title={t("ladder.errorTitle")}
                  retryLabel={t("common.retry")}
                  retryA11yLabel={t("ladder.errorRetry")}
                  onRetry={() => ratingQuery.refetch()}
                />
              )}
              {rating && (() => {
                const season = t("ladder.seasonLabel", { season: formatSeason(rating.season, t) });
                const games = rating.provisional
                  ? t("ladder.provisional", { n: PROVISIONAL_GAMES - rating.games })
                  : t("ladder.gamesLabel", { n: rating.games });
                return (
                  <View
                    style={styles.ratingBlock}
                    {...a11yGroup(`${t("ladder.ratingLabel")}: ${rating.rating}. ${season}. ${games}`)}
                  >
                    <Text style={styles.ratingValue} {...a11yHidden()}>{rating.rating}</Text>
                    <Text style={styles.ratingSeason} {...a11yHidden()}>{season}</Text>
                    <Text style={styles.ratingGames} {...a11yHidden()}>{games}</Text>
                  </View>
                );
              })()}
              <MenuButton
                label={t("ladder.open")}
                onPress={() => router.push("/(online)/leaderboard")}
                variant="secondary"
                size="sm"
                accessibilityLabel={t("ladder.open")}
                icon={<Ionicons name="trophy-outline" size={16} color={Colors.gold} />}
              />
            </MenuCard>
          </Animated.View>

        {/* ── Statistiche ── */}
          <Animated.View entering={entering}>
            <MenuCard title={t("profile.statsTitle")}>
              {statsQuery.isLoading && <LoadingBlock label={t("profile.statsLoadingA11yLabel")} />}
              {statsQuery.isError && (
                <ErrorBlock
                  title={t("profile.statsErrorTitle")}
                  retryLabel={t("common.retry")}
                  retryA11yLabel={t("profile.retryStatsA11yLabel")}
                  onRetry={() => statsQuery.refetch()}
                />
              )}
              {stats && stats.gamesPlayed === 0 && (
                <EmptyBlock
                  icon="game-controller-outline"
                  title={t("profile.statsEmptyTitle")}
                  body={t("profile.statsEmptyBody")}
                />
              )}
              {stats && stats.gamesPlayed > 0 && (
                <View style={styles.statsGrid}>
                  <StatTile icon="game-controller" value={String(stats.gamesPlayed)} label={t("profile.statGamesPlayed")} />
                  <StatTile icon="trophy" value={String(stats.gamesWon)} label={t("profile.statGamesWon")} />
                  <StatTile icon="stats-chart" value={`${winRate}%`} label={t("profile.statWinRate")} />
                  <StatTile icon="ribbon" value={String(stats.matchesWon)} label={t("profile.statMatchesWon")} />
                  <StatTile icon="flame" value={String(stats.currentStreak)} label={t("profile.statCurrentStreak")} />
                  <StatTile icon="flash" value={String(stats.bestStreak)} label={t("profile.statBestStreak")} />
                  <StatTile icon="rocket" value={String(stats.bombsPlayed)} label={t("profile.statBombsPlayed")} />
                  <StatTile icon="calendar" value={String(stats.dailyStreak)} label={t("profile.statDailyStreak")} />
                </View>
              )}
            </MenuCard>
          </Animated.View>

          {/* ── Andamento ── */}
          {history.length > 0 && (
            <Animated.View entering={entering}>
              <MenuCard title={t("profile.formTitle")}>
                <Text style={styles.formNote}>
                  {t("profile.formSampleNote", { n: Math.min(history.length, RECENT_FORM_LIMIT) })}
                </Text>

                <Text style={styles.formLabel}>{t("profile.formRecentLabel")}</Text>
                <View
                  style={styles.formStrip}
                  {...a11yGroup(
                    t("profile.formRecentA11yLabel", {
                      results: recentForm(history)
                        .map((p) => t(POSITION_LABEL_KEYS[p - 1] ?? "gameOverOverlay.position4"))
                        .join(", "),
                    })
                  )}
                >
                  {recentForm(history).map((placement, i) => (
                    <View
                      key={i}
                      style={[styles.formPip, { backgroundColor: placementColor(placement) }]}
                    />
                  ))}
                </View>

                <Text style={styles.formLabel}>{t("profile.formDistributionLabel")}</Text>
                {placementDistribution(history).map((slice) => {
                  const posText = t(
                    POSITION_LABEL_KEYS[slice.placement - 1] ?? "gameOverOverlay.position4"
                  );
                  return (
                    <View
                      key={slice.placement}
                      style={styles.formBarRow}
                      {...a11yGroup(
                        t("profile.formPlacementRowA11yLabel", {
                          position: posText,
                          n: slice.played,
                          total: history.length,
                        })
                      )}
                    >
                      <Text style={styles.formBarKey} {...a11yHidden()}>{posText}</Text>
                      <View style={styles.formBarTrack}>
                        <View
                          style={[
                            styles.formBarFill,
                            {
                              width: `${Math.round(slice.share * 100)}%`,
                              backgroundColor: placementColor(slice.placement),
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.formBarValue} {...a11yHidden()}>{slice.played}</Text>
                    </View>
                  );
                })}

                <Text style={styles.formLabel}>{t("profile.formByPlayersLabel")}</Text>
                {byPlayerCount(history).map((slice) => (
                  <View
                    key={slice.playerCount}
                    style={styles.formCountRow}
                    {...a11yGroup(
                      t("profile.formByPlayersRowA11yLabel", {
                        players: tn("profile.historyPlayers", slice.playerCount),
                        played: slice.played,
                        won: slice.won,
                        avg: slice.averagePlacement,
                      })
                    )}
                  >
                    <Text style={styles.formCountKey} {...a11yHidden()}>
                      {tn("profile.historyPlayers", slice.playerCount)}
                    </Text>
                    <Text style={styles.formCountValue} {...a11yHidden()}>
                      {t("profile.formAveragePlacement", { n: slice.averagePlacement })}
                    </Text>
                  </View>
                ))}
              </MenuCard>
            </Animated.View>
          )}

          {/* ── Partite recenti ── */}
          <Animated.View entering={entering}>
            <MenuCard title={t("profile.historyTitle")}>
              {historyQuery.isLoading && <LoadingBlock label={t("profile.historyLoadingA11yLabel")} />}
              {historyQuery.isError && (
                <ErrorBlock
                  title={t("profile.historyErrorTitle")}
                  retryLabel={t("common.retry")}
                  retryA11yLabel={t("profile.retryHistoryA11yLabel")}
                  onRetry={() => historyQuery.refetch()}
                />
              )}
              {historyQuery.isSuccess && history.length === 0 && (
                <EmptyBlock
                  icon="time-outline"
                  title={t("profile.historyEmptyTitle")}
                  body={t("profile.historyEmptyBody")}
                />
              )}
              {history.length > 0 && (
                <View style={styles.listBlock}>
                  {history.map((h) => {
                    const labelKey = POSITION_LABEL_KEYS[h.placement - 1];
                    const posText = labelKey ? t(labelKey) : `${h.placement}°`;
                    const modeText = h.gameMode === "teams" ? t("gameOverOverlay.modeTeams") : t("gameOverOverlay.modeFreeForAll");
                    const timeText = relativeTime(h.finishedAt, t, tn);
                    const pointsText = t("gameOverOverlay.pointsAbbrev", { n: h.points });
                    const playersText = tn("profile.historyPlayers", h.playerCount);
                    const rowLabel = t("profile.historyRowA11yLabel", {
                      position: posText,
                      mode: modeText,
                      players: playersText,
                      points: h.points,
                      time: timeText,
                    });
                    return (
                      <View key={h.id} style={styles.row} {...a11yGroup(rowLabel)}>
                        <View
                          style={[styles.posBadge, h.placement === 1 && styles.posBadgeWinner]}
                          {...a11yHidden()}
                        >
                          <Text style={[styles.posBadgeText, h.placement === 1 && styles.posBadgeTextWinner]}>
                            {posText}
                          </Text>
                        </View>
                        <View style={styles.rowInfo} {...a11yHidden()}>
                          <Text style={styles.rowName}>{modeText} · {playersText}</Text>
                          <Text style={styles.rowSub}>{timeText}</Text>
                        </View>
                        <Text style={styles.rowPoints} {...a11yHidden()}>{pointsText}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </MenuCard>
          </Animated.View>

          {/* ── Replay ── */}
          <Animated.View entering={entering}>
            <MenuCard title={t("replay.cardTitle")}>
              {replaysQuery.isLoading && <LoadingBlock label={t("replay.loadingA11yLabel")} />}
              {replaysQuery.isError && (
                <ErrorBlock
                  title={t("replay.errorTitle")}
                  retryLabel={t("replay.errorRetry")}
                  retryA11yLabel={t("replay.errorRetry")}
                  onRetry={() => replaysQuery.refetch()}
                />
              )}
              {replaysQuery.isSuccess && replays.length === 0 && (
                <EmptyBlock
                  icon="play-circle-outline"
                  title={t("replay.emptyTitle")}
                  body={t("replay.emptyBody", { days: REPLAY_RETENTION_DAYS })}
                />
              )}
              {replays.length > 0 && (
                <View style={styles.listBlock}>
                  {replays.map((r) => {
                    const modeText = r.gameMode === "teams" ? t("gameOverOverlay.modeTeams") : t("gameOverOverlay.modeFreeForAll");
                    const playersText = tn("profile.historyPlayers", r.playerCount);
                    const timeText = relativeTime(r.finishedAt, t, tn);
                    const movesText = tn("replay.moves", r.moveCount);
                    return (
                      <Pressable
                        key={r.id}
                        style={styles.row}
                        onPress={() => router.push({ pathname: "/(online)/replay", params: { id: r.id } })}
                        accessibilityRole="button"
                        accessibilityLabel={t("replay.rowA11yLabel", {
                          mode: modeText,
                          players: playersText,
                          time: timeText,
                          moves: movesText,
                        })}
                      >
                        <Ionicons
                          name="play-circle"
                          size={28}
                          color={Colors.gold}
                          {...a11yHidden()}
                        />
                        <View style={styles.rowInfo} {...a11yHidden()}>
                          <Text style={styles.rowName}>{modeText} · {playersText}</Text>
                          <Text style={styles.rowSub}>{timeText}</Text>
                        </View>
                        <Text style={styles.rowPoints} {...a11yHidden()}>
                          {movesText}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </MenuCard>
          </Animated.View>

          {/* ── Obiettivi ── */}
          <Animated.View entering={entering}>
            <MenuCard title={achievementsTitle}>
              {achievementsQuery.isLoading && <LoadingBlock label={t("profile.achievementsLoadingA11yLabel")} />}
              {achievementsQuery.isError && (
                <ErrorBlock
                  title={t("profile.achievementsErrorTitle")}
                  retryLabel={t("common.retry")}
                  retryA11yLabel={t("profile.retryAchievementsA11yLabel")}
                  onRetry={() => achievementsQuery.refetch()}
                />
              )}
              {achievements.length > 0 && (
                <View style={styles.listBlock}>
                  {achievements.map((a) => {
                    const name = t(a.nameKey as TranslationKey);
                    const desc = t(a.descKey as TranslationKey);
                    const statusText = a.unlocked
                      ? t("profile.achievementUnlockedOn", { time: relativeTime(a.unlockedAt, t, tn) })
                      : t("profile.achievementLockedLabel");
                    const rowLabel = `${name}. ${desc}. ${statusText}`;
                    return (
                      <View
                        key={a.id}
                        style={[styles.achievementRow, !a.unlocked && styles.achievementRowLocked]}
                        {...a11yGroup(rowLabel)}
                      >
                        <View
                          style={[styles.achievementIcon, a.unlocked && styles.achievementIconUnlocked]}
                          {...a11yHidden()}
                        >
                          <Ionicons
                            name={a.unlocked ? "trophy" : "lock-closed"}
                            size={18}
                            color={a.unlocked ? Colors.bgCard : Colors.textMuted}
                          />
                        </View>
                        <View style={styles.rowInfo} {...a11yHidden()}>
                          <Text style={[styles.achievementName, !a.unlocked && styles.achievementNameLocked]}>
                            {name}
                          </Text>
                          <Text style={styles.achievementDesc}>{desc}</Text>
                          {a.unlocked && <Text style={styles.achievementUnlockedText}>{statusText}</Text>}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </MenuCard>
          </Animated.View>
      </View>
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
  screenTitle: {
    flex: 1,
    textAlign: "center",
    ...Type.heading,
    fontSize: FontSize.xl,
    letterSpacing: 3,
  },
  contentWrapper: {
    gap: Spacing.sm,
  },

  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  userIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  renameBtn: {
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
  renameCard: {
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: TOUCH_TARGET_MIN,
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
    borderRadius: Radius.sm,
    backgroundColor: Colors.bgCard,
  },
  renameInput: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.md,
    color: Colors.text,
  },
  renameError: { ...Type.caption, color: Colors.dangerDim },
  renameActions: { flexDirection: "row", gap: Spacing.sm },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    backgroundColor: Colors.felt,
    borderWidth: 1,
    borderColor: Colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.xl, color: Colors.gold },
  username: { ...Type.heading, fontSize: FontSize.lg },

  stateBlock: { alignItems: "center", paddingVertical: Spacing.lg, gap: Spacing.sm },
  stateTitle: { ...Type.label, textAlign: "center" },
  stateBody: { ...Type.caption, textAlign: "center", lineHeight: 18, maxWidth: 280 },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  statTile: {
    width: "31%",
    minHeight: READABLE_ROW_H,
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.sm,
    alignItems: "center",
    gap: Spacing.xxs,
  },
  statValue: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.lg, color: Colors.text },
  statLabel: { ...Type.caption, textAlign: "center" },

  formNote: {
    ...Type.caption,
    color: Colors.textMuted,
  },
  formLabel: {
    ...Type.caption,
    color: Colors.gold,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  formStrip: {
    flexDirection: "row",
    gap: Spacing.xs,
    alignItems: "center",
  },
  formPip: {
    width: Spacing.sm,
    height: Spacing.md,
    borderRadius: Radius.sm,
  },
  formBarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  formBarKey: {
    ...Type.caption,
    width: FORM_KEY_W,
  },
  formBarTrack: {
    flex: 1,
    height: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: Colors.bgSurface,
  },
  formBarFill: {
    height: Spacing.sm,
    borderRadius: Radius.sm,
  },
  formBarValue: {
    ...Type.caption,
    color: Colors.textMuted,
    width: FORM_VALUE_W,
    textAlign: "right",
  },
  formCountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xs,
  },
  formCountKey: {
    ...Type.caption,
  },
  formCountValue: {
    ...Type.caption,
    color: Colors.textMuted,
  },
  listBlock: { gap: Spacing.sm },

  ratingBlock: { alignItems: "center", gap: Spacing.xs / 2, paddingBottom: Spacing.md },
  ratingValue: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.hero, color: Colors.gold },
  ratingSeason: { ...Type.label },
  ratingGames: { ...Type.caption, textAlign: "center" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.sm,
    gap: Spacing.sm,
    minHeight: TOUCH_TARGET_MIN,
  },
  posBadge: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  posBadgeWinner: { borderColor: Colors.gold },
  posBadgeText: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.sm, color: Colors.textSecondary },
  posBadgeTextWinner: { color: Colors.gold },
  rowInfo: { flex: 1, gap: Spacing.xxs },
  rowName: { ...Type.bodyStrong },
  rowSub: { ...Type.caption },
  rowPoints: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.md, color: Colors.gold },

  achievementRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
    padding: Spacing.sm,
    gap: Spacing.sm,
    minHeight: READABLE_ROW_H,
  },
  achievementRowLocked: { borderColor: Colors.border, opacity: 0.7 },
  achievementIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  achievementIconUnlocked: { backgroundColor: Colors.gold },
  achievementName: { ...Type.bodyStrong },
  achievementNameLocked: { color: Colors.textSecondary },
  achievementDesc: { ...Type.caption, lineHeight: 16, marginTop: Spacing.xxs },
  achievementUnlockedText: { ...Type.caption, color: Colors.gold, marginTop: Spacing.xxs },
});
