import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { Colors, Spacing, Radius, FontSize, Type, Motion, Shadow, TOUCH_TARGET_MIN } from "@/lib/theme";
import { ScreenHeader } from "@/components/ScreenHeader";
import { MenuLayout } from "@/components/MenuLayout";
import { Avatar } from "@/components/Avatar";
import { MenuCard } from "@/components/MenuCard";
import { AppModal } from "@/components/AppModal";
import {
  recentForm,
  placementDistribution,
  byPlayerCount,
  RECENT_FORM_LIMIT,
} from "@/lib/profileStats";
import { MenuButton } from "@/components/MenuButton";
import { IconButton } from "@/components/IconButton";
import { LoadingBlock, ErrorBlock, EmptyBlock } from "@/components/StateBlock";
import { LookPicker } from "@/components/LookPicker";
import { useTranslation } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";
import type { TranslationKey } from "@/lib/i18n";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { PROVISIONAL_GAMES, formatSeason } from "@/lib/rating";
import { a11yGroup, a11yHidden } from "@/lib/a11y";
import { shouldShowAddEmailCard } from "@/lib/emailNudge";
import { HistoryRow } from "@/components/HistoryRow";
import { serverErrorMessage } from "@/lib/apiError";
import { USERNAME_MAX, USERNAME_MIN, usernameProblem } from "@/shared/username";
import { placementColor, positionLabelKey } from "@/lib/placement";
import type { UserStatsDto, RatingDto, AchievementStatusDto, MatchHistoryDto } from "@/lib/wire";

type IconName = React.ComponentProps<typeof Ionicons>["name"];



/** How many hands the card lists before the door out to the rest. */
const HISTORY_ROWS_SHOWN = 5;
/** Every glyph on this screen is one size; only the avatar is not. */
const GLYPH = 18;


/** The floor a stat tile and an achievement row read at. Neither takes a press. */
const READABLE_ROW_H = 44;
const FORM_KEY_W = 34;
const FORM_VALUE_W = 28;
const MODAL_MAX_W = 340;


function StatTile({ icon, value, label }: { icon: IconName; value: string; label: string }) {
  return (
    <View style={styles.statTile} {...a11yGroup(`${label}: ${value}`)}>
      <Ionicons name={icon} size={GLYPH} color={Colors.gold} {...a11yHidden()} />
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
          <Avatar name={user.username} size="xl" ring />
          <Text style={styles.username} numberOfLines={1} {...a11yHidden()}>
            {user.username}
          </Text>
        </View>
        <IconButton
          name="pencil"
          label={t("profile.renameA11yLabel")}
          onPress={open}
          size={GLYPH}
          testID="btn-rename"
        />
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

      {/* `MenuButton` fills the width it is given, so two of them side by side
          need a half each to fill — sharing the row is the parent's job. */}
      <View style={styles.renameActions}>
        <View style={styles.renameAction}>
          <MenuButton
            label={t("common.cancel")}
            variant="ghost"
            onPress={() => setEditing(false)}
            disabled={saving}
          />
        </View>
        <View style={styles.renameAction}>
          <MenuButton
            label={saving ? t("profile.renameSaving") : t("common.save")}
            onPress={save}
            disabled={saving}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * A logged-in user who still knows their current password sets a new one.
 * Requires the current password (a live session alone is not proof of intent
 * to change a credential — server/routes.ts's change-password route) and
 * clears every other session for the account on success.
 */
function ChangePasswordCard() {
  const { t } = useTranslation();
  const { changePassword } = useAuth();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (saving) return;
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setError(null);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await changePassword(currentPassword, newPassword);
      setOpen(false);
      setCurrentPassword("");
      setNewPassword("");
    } catch (e: unknown) {
      setError(serverErrorMessage(e, t("profile.changePasswordFailed")));
    }
    setSaving(false);
  }

  return (
    <>
      <MenuCard title={t("profile.securityTitle")}>
        <MenuButton
          label={t("profile.changePasswordAction")}
          variant="secondary"
          onPress={() => setOpen(true)}
        />
      </MenuCard>

      <AppModal visible={open} onRequestClose={close}>
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            disabled={saving}
            {...a11yHidden()}
          />
          <View style={styles.modalCard} accessibilityViewIsModal accessibilityRole="none">
            <Text style={styles.modalTitle} accessibilityRole="header">
              {t("profile.changePasswordModalTitle")}
            </Text>

            <TextInput
              style={styles.modalInput}
              value={currentPassword}
              onChangeText={(v) => { setCurrentPassword(v); setError(null); }}
              placeholder={t("profile.changePasswordCurrentPlaceholder")}
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              accessibilityLabel={t("profile.changePasswordCurrentA11yLabel")}
              editable={!saving}
              testID="input-current-password"
            />
            <TextInput
              style={styles.modalInput}
              value={newPassword}
              onChangeText={(v) => { setNewPassword(v); setError(null); }}
              placeholder={t("profile.changePasswordNewPlaceholder")}
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={submit}
              accessibilityLabel={t("profile.changePasswordNewA11yLabel")}
              editable={!saving}
              testID="input-new-password"
            />
            <Text style={styles.modalHint}>{t("profile.changePasswordHint")}</Text>

            {error && (
              <Text style={styles.modalError} accessibilityLiveRegion="polite" testID="change-password-error">
                {error}
              </Text>
            )}

            <View style={styles.modalActions}>
              <View style={styles.modalAction}>
                <MenuButton label={t("common.cancel")} variant="ghost" onPress={close} disabled={saving} />
              </View>
              <View style={styles.modalAction}>
                <MenuButton
                  label={saving ? t("profile.changePasswordSaving") : t("common.save")}
                  onPress={submit}
                  disabled={saving || !currentPassword || !newPassword}
                />
              </View>
            </View>
          </View>
        </View>
      </AppModal>
    </>
  );
}

/**
 * The non-blocking nudge for an account that predates the email requirement
 * (#863, `lib/emailNudge.ts`) — never a login wall, never an `Alert`. Submitting
 * mints an `email_verify` token and sends it through the same machinery signup
 * uses; server/routes.ts's `/api/auth/verify-email` (reached from the emailed
 * link, not from this screen) is what redeems it and makes the card disappear
 * on the next `/api/auth/me`.
 */
function AddEmailCard() {
  const { t } = useTranslation();
  const { addEmail } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (saving) return;
    setOpen(false);
    setEmail("");
    setError(null);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await addEmail(email.trim());
      setOpen(false);
      setEmail("");
    } catch (e: unknown) {
      setError(serverErrorMessage(e, t("profile.addEmailFailed")));
    }
    setSaving(false);
  }

  return (
    <>
      <MenuCard title={t("profile.addEmailTitle")}>
        <Text style={styles.addEmailBody}>{t("profile.addEmailBody")}</Text>
        <MenuButton
          label={t("profile.addEmailAction")}
          variant="secondary"
          onPress={() => setOpen(true)}
        />
      </MenuCard>

      <AppModal visible={open} onRequestClose={close}>
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            disabled={saving}
            {...a11yHidden()}
          />
          <View style={styles.modalCard} accessibilityViewIsModal accessibilityRole="none">
            <Text style={styles.modalTitle} accessibilityRole="header">
              {t("profile.addEmailModalTitle")}
            </Text>

            <TextInput
              style={styles.modalInput}
              value={email}
              onChangeText={(v) => { setEmail(v); setError(null); }}
              placeholder={t("profile.addEmailPlaceholder")}
              placeholderTextColor={Colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="done"
              onSubmitEditing={submit}
              accessibilityLabel={t("profile.addEmailA11yLabel")}
              editable={!saving}
              testID="input-add-email"
            />

            {error && (
              <Text style={styles.modalError} accessibilityLiveRegion="polite" testID="add-email-error">
                {error}
              </Text>
            )}

            <View style={styles.modalActions}>
              <View style={styles.modalAction}>
                <MenuButton label={t("common.cancel")} variant="ghost" onPress={close} disabled={saving} />
              </View>
              <View style={styles.modalAction}>
                <MenuButton
                  label={saving ? t("profile.addEmailSaving") : t("common.save")}
                  onPress={submit}
                  disabled={saving || !email.trim()}
                />
              </View>
            </View>
          </View>
        </View>
      </AppModal>
    </>
  );
}

/**
 * What an account adds, for a player who has not got one.
 *
 * Not a redirect and not a disabled section: this screen exists outside the
 * `(online)` group so the look picker below works with no account, and
 * bouncing a signed-out player away from it would undo that.
 */
function SignInCard() {
  const { t } = useTranslation();
  return (
    <MenuCard>
      <View style={styles.signedOut}>
        <Text style={styles.signedOutBody}>{t("profile.signedOutBody")}</Text>
        <MenuButton
          label={t("profile.signedOutAction")}
          onPress={() => router.push("/auth")}
        />
      </View>
    </MenuCard>
  );
}

/**
 * The three things this screen is. "Make it clear" is the requirement, and a
 * long scroll of cards with their own titles is what it was asked to replace.
 */
function SectionHeading({ label }: { label: string }) {
  return (
    <Text style={styles.sectionHeading} accessibilityRole="header">
      {label}
    </Text>
  );
}

export default function ProfileScreen() {
  const { t, tn } = useTranslation();
  // `loading` matters here in a way it never did inside the `(online)` group,
  // whose layout held a spinner until the session resolved. Outside it, `user`
  // is null for the first frames of every cold load, and a signed-in player
  // would be told they have no account until the session comes back. The Look
  // section does not depend on the answer and renders throughout.
  const { user, loading } = useAuth();
  const reduceMotion = usePrefersReducedMotion();

  // Every one of these needs a session. The screen is reachable without one
  // now, and a query left running there is five 401s and a record section
  // that renders nothing anyway.
  const signedIn = !!user;
  const statsQuery = useQuery<UserStatsDto>({ queryKey: ["/api/stats/me"], enabled: signedIn });
  const historyQuery = useQuery<MatchHistoryDto[]>({
    queryKey: ["/api/stats/history"],
    enabled: signedIn,
  });
  const achievementsQuery = useQuery<AchievementStatusDto[]>({
    queryKey: ["/api/stats/achievements"],
    enabled: signedIn,
  });
  const ratingQuery = useQuery<RatingDto>({ queryKey: ["/api/ratings/me"], enabled: signedIn });

  const stats = statsQuery.data;
  const history = historyQuery.data ?? [];
  const achievements = achievementsQuery.data ?? [];
  const rating = ratingQuery.data;
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const winRate = stats && stats.gamesPlayed > 0 ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0;

  const achievementsTitle = achievementsQuery.isSuccess
    ? `${t("profile.achievementsTitle")} · ${unlockedCount}/${achievements.length}`
    : t("profile.achievementsTitle");

  const entering = reduceMotion ? undefined : FadeIn.duration(Motion.duration.travel);

  return (
    <MenuLayout scrollable centered={false}>
      <ScreenHeader title={t("profile.title")} />

      <View style={styles.contentWrapper}>
        <SectionHeading label={t("profile.youTitle")} />
        {user ? <UserCard user={user} /> : loading ? null : <SignInCard />}
        {user && <ChangePasswordCard />}
        {user && shouldShowAddEmailCard(user) && <AddEmailCard />}

        <SectionHeading label={t("profile.lookTitle")} />
        <LookPicker />

        {/* ── Classifica ── */}
        {/* Ahead of Statistiche: it's the one card whose control (open the
            ladder) is useful before a player has any stats to show. */}
        {user && (
        <>
          <SectionHeading label={t("profile.recordTitle")} />
          <Animated.View entering={entering}>
            <MenuCard title={t("ladder.cardTitle")}>
              {ratingQuery.isLoading && <LoadingBlock label={t("ladder.loadingA11yLabel")} />}
              {ratingQuery.isError && (
                <ErrorBlock
                  title={t("ladder.errorTitle")}
                  retry={{ label: t("common.retry"), a11yLabel: t("ladder.errorRetry"), onPress: () => ratingQuery.refetch() }}
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
                  retry={{ label: t("common.retry"), a11yLabel: t("profile.retryStatsA11yLabel"), onPress: () => statsQuery.refetch() }}
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
                        .map((p) => t(positionLabelKey(p) ?? "result.position4"))
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
                    positionLabelKey(slice.placement) ?? "result.position4"
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
                        players: tn("history.players", slice.playerCount),
                        played: slice.played,
                        won: slice.won,
                        avg: slice.averagePlacement,
                      })
                    )}
                  >
                    <Text style={styles.formCountKey} {...a11yHidden()}>
                      {tn("history.players", slice.playerCount)}
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
            <MenuCard title={t("history.cardTitle")}>
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
              {history.length > 0 && (
                <View style={styles.listBlock}>
                  {history.slice(0, HISTORY_ROWS_SHOWN).map((h) => (
                    <HistoryRow key={h.id} hand={h} />
                  ))}
                  {history.length > HISTORY_ROWS_SHOWN && (
                    <Pressable
                      style={styles.doorRow}
                      onPress={() => router.push("/(online)/history")}
                      accessibilityRole="button"
                      accessibilityLabel={t("history.doorA11yLabel", {
                        n: history.length,
                      })}
                    >
                      <Text style={styles.doorText} {...a11yHidden()}>
                        {t("history.door", { count: history.length })}
                      </Text>
                      <Ionicons
                        name="chevron-forward"
                        size={GLYPH}
                        color={Colors.gold}
                        {...a11yHidden()}
                      />
                    </Pressable>
                  )}
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
                  retry={{ label: t("common.retry"), a11yLabel: t("profile.retryAchievementsA11yLabel"), onPress: () => achievementsQuery.refetch() }}
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
                            size={GLYPH}
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
        </>
        )}
      </View>
    </MenuLayout>
  );
}

const styles = StyleSheet.create({
  sectionHeading: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.lg,
    letterSpacing: 2,
    color: Colors.gold,
    textTransform: "uppercase",
    marginTop: Spacing.sm,
  },
  addEmailBody: {
    fontFamily: "Rajdhani_500Medium",
    fontSize: FontSize.sm,
    lineHeight: FontSize.sm * 1.4,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  signedOut: { gap: Spacing.md },
  signedOutBody: {
    fontFamily: "Rajdhani_500Medium",
    fontSize: FontSize.md,
    lineHeight: FontSize.md * 1.5,
    color: Colors.textSecondary,
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
  renameAction: { flex: 1 },
  username: { ...Type.heading, fontSize: FontSize.lg },

  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxWidth: MODAL_MAX_W,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.overlay,
  },
  modalTitle: {
    ...Type.heading,
    color: Colors.gold,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  modalInput: {
    minHeight: TOUCH_TARGET_MIN,
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
    borderRadius: Radius.sm,
    backgroundColor: Colors.bgSurface,
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.md,
    color: Colors.text,
  },
  modalHint: { ...Type.caption, color: Colors.textMuted },
  modalError: { ...Type.caption, color: Colors.dangerDim },
  modalActions: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.sm },
  modalAction: { flex: 1 },


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
  doorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    minHeight: TOUCH_TARGET_MIN,
  },
  doorText: { ...Type.label, color: Colors.gold },

  ratingBlock: { alignItems: "center", gap: Spacing.xs / 2, paddingBottom: Spacing.md },
  ratingValue: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.hero, color: Colors.gold },
  ratingSeason: { ...Type.label },
  ratingGames: { ...Type.caption, textAlign: "center" },

  rowInfo: { flex: 1, gap: Spacing.xxs },

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
