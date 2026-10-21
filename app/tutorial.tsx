import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import { uiFeedback } from "@/lib/device/feedback";
import { leaveScreen } from "@/components/ScreenHeader";
import { Colors, Spacing, Radius, FontSize, Type, Motion, TOUCH_TARGET_MIN } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { markTutorialSeen } from "@/lib/tutorialSeen";
import { useAuth } from "@/context/AuthContext";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { CardView } from "@/components/CardView";
import { TutorialCard } from "@/components/TutorialCard";
import type { Card } from "@/lib/game/gameEngine";
import {
  buildBeats,
  evaluateExchange,
  evaluatePlay,
  stageBeat,
  type ExchangeBeat,
  type PlayBeat,
} from "@/lib/tutorial/beats";
import { clearProgress, loadResumeIndex, saveProgress } from "@/lib/tutorial/progress";
import { useTranslation } from "@/lib/i18n";
import { IconButton } from "@/components/IconButton";
import { A11yStatus, a11yHidden } from "@/lib/a11y";
import { TurnChip } from "@/components/table/notices/hud";
import { playRefusalLabel } from "@/components/table/spokenLabels";


// ─── Screen ─────────────────────────────────────────────────────────────────

function FeedbackBox({ feedback }: { feedback: { ok: boolean; text: string } | null }) {
  return (
    <>
      <A11yStatus label={feedback?.text ?? ""} role={feedback && !feedback.ok ? "alert" : "text"} />
      {feedback && (
        <View
          style={[styles.feedbackBox, feedback.ok ? styles.feedbackOk : styles.feedbackError]}
          {...a11yHidden()}
        >
          <Ionicons
            name={feedback.ok ? "checkmark-circle" : "close-circle"}
            size={18}
            color={feedback.ok ? Colors.accent : Colors.dangerDim}
            {...a11yHidden()}
          />
          <Text style={[styles.feedbackText, { color: feedback.ok ? Colors.text : Colors.dangerDim }]}>
            {feedback.text}
          </Text>
        </View>
      )}
    </>
  );
}

export default function TutorialScreen() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const reduceMotion = usePrefersReducedMotion();
  const BEATS = React.useMemo(() => buildBeats(t), [t]);
  const [stepIndex, setStepIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [beatDone, setBeatDone] = useState(false);
  const [clockRun, setClockRun] = useState(0);

  // Not until the session has been asked: a player who opens this screen and
  // leaves again before AuthProvider answers would otherwise be recorded on
  // the device only, which is the whole defect on the next phone.
  useEffect(() => {
    if (authLoading) return;
    void markTutorialSeen(userId);
  }, [authLoading, userId]);

  useEffect(() => {
    loadResumeIndex(BEATS.map((b) => b.id))
      .then(setStepIndex)
      .finally(() => setLoaded(true))
      .catch(() => {});
  }, [BEATS]);

  const stepId = BEATS[stepIndex]?.id;
  useEffect(() => {
    if (!loaded || !stepId) return;
    void saveProgress(stepId);
  }, [stepId, loaded]);

  const [shownStep, setShownStep] = useState(stepIndex);
  if (stepIndex !== shownStep) {
    setShownStep(stepIndex);
    setSelectedIds(new Set());
    setFeedback(null);
    setBeatDone(false);
  }

  if (!loaded) return null;

  const beat = BEATS[stepIndex];
  const isLast = stepIndex === BEATS.length - 1;

  async function handleSkip() {
    uiFeedback("light");
    // Nothing between the press and the navigation may be able to outlive it.
    // The resume marker is not read again until this screen is next opened, so
    // clearing it is started rather than waited on; the seen flag is awaited
    // because the home screen reads it on the very next mount, and the mount
    // effect above has not written it yet if the session is still being asked.
    void clearProgress();
    await markTutorialSeen(userId);
    router.replace("/");
  }

  function goBack() {
    if (stepIndex > 0) {
      uiFeedback("selection");
      setStepIndex((i) => i - 1);
    } else {
      leaveScreen();
    }
  }

  async function goNext() {
    if (isLast) {
      uiFeedback("success");
      await clearProgress();
      router.replace({ pathname: "/lobby", params: { mode: "bot" } });
      return;
    }
    uiFeedback("selection");
    setStepIndex((i) => i + 1);
  }

  function toggleCard(card: Card, singleSelect: boolean) {
    if (beatDone) return;
    setFeedback(null);
    setSelectedIds((prev) => {
      if (singleSelect) return new Set([card.id]);
      const next = new Set(prev);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      return next;
    });
  }

  function settle(result: { ok: boolean; message: string }) {
    setFeedback({ ok: result.ok, text: result.message });
    uiFeedback(result.ok ? "success" : "error");
    if (result.ok) setBeatDone(true);
  }

  const submitPlay = (b: PlayBeat) => settle(evaluatePlay(selectedIds, b, t));
  const submitPass = (b: PlayBeat) => settle({ ok: true, message: b.successNarrative });

  function submitExchange(b: ExchangeBeat) {
    const selected = b.state.players[b.state.exchangePhase.winnerIdx].hand.find((c) => selectedIds.has(c.id));
    if (!selected) setFeedback({ ok: false, text: t("tutorial.errSelectCardToReturn") });
    else settle(evaluateExchange(selected, b, t));
  }

  const header = (
    <View style={styles.header}>
      <IconButton name="chevron-back" label={t("tutorial.backA11yLabel")} onPress={goBack} />
      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((stepIndex + 1) / BEATS.length) * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {t("tutorial.progressText", { current: stepIndex + 1, total: BEATS.length })}
        </Text>
      </View>
      <Pressable onPress={handleSkip} style={styles.skipBtn} accessibilityRole="button" accessibilityLabel={t("tutorial.skipA11yLabel")}>
        <Text
          style={styles.skipText}
          {...a11yHidden()}
        >
          {t("tutorial.skip")}
        </Text>
      </Pressable>
    </View>
  );

  function renderBody() {
    if (beat.kind === "info" || beat.kind === "complete") {
      return (
        <MenuCard title={beat.kind === "complete" ? t("tutorial.cardTitleComplete") : t("tutorial.cardTitleQuickGuide")}>
          <Text style={styles.beatTitle} accessibilityRole="header">
            {beat.title}
          </Text>
          {beat.body.map((p, i) => (
            <Text key={i} style={styles.paragraph}>
              {p}
            </Text>
          ))}
          {beat.kind === "info" && beat.clockSeconds !== undefined && (
            <View style={styles.clockRow}>
              <TurnChip
                seconds={beat.clockSeconds}
                active
                resetKey={String(clockRun)}
                onExpire={() => setClockRun((n) => n + 1)}
                scale={1}
                lit
                chipText={t("gameShared.yourTurn")}
                spokenSeat={t("gameTable.a11yYourTurn")}
              />
            </View>
          )}
        </MenuCard>
      );
    }

    if (beat.kind === "play") {
      const staged = stageBeat(beat, selectedIds);
      const stagedLine =
        beat.staged && !beatDone && selectedIds.size > 0
          ? staged.playable
            ? t("tutorial.stagedReady")
            : t("tutorial.stagedBlocked", {
                reason: playRefusalLabel(
                  { refusal: staged.refusal, isMyTurn: true, isFinished: false, openingCard: null },
                  t
                ),
              })
          : null;
      return (
        <>
          <MenuCard title={beat.title}>
            <Text style={styles.instruction}>{beat.instruction}</Text>
            {beat.tip && (
              <View style={styles.tipBox}>
                <Ionicons name="information-circle-outline" size={16} color={Colors.gold} {...a11yHidden()} />
                <Text style={styles.tipText}>{beat.tip}</Text>
              </View>
            )}
          </MenuCard>

          {beat.demand.toBeat && (
            <MenuCard title={beat.opponentLabel ?? t("tutorial.onTable")}>
              <View style={styles.cardRow}>
                {beat.demand.toBeat.cards.map((c) => (
                  <CardView key={c.id} card={c} scale={0.625} compact />
                ))}
              </View>
            </MenuCard>
          )}

          <MenuCard title={t("tutorial.yourHand")}>
            <View style={styles.cardRow}>
              {beat.handCards.map((c) => (
                <TutorialCard
                  key={c.id}
                  testID={`tutorial-card-${c.id}`}
                  card={c}
                  selected={selectedIds.has(c.id)}
                  disabled={beatDone}
                  onPress={() => toggleCard(c, false)}
                  style={beat.highlightIds.includes(c.id) ? styles.highlightRing : undefined}
                />
              ))}
            </View>
            <A11yStatus label={stagedLine ?? ""} />
            {stagedLine !== null && (
              <Text
                testID="tutorial-staged"
                style={[styles.stagedText, staged.playable && styles.stagedReady]}
                {...a11yHidden()}
              >
                {stagedLine}
              </Text>
            )}
          </MenuCard>

          <FeedbackBox feedback={feedback} />

          {!beatDone && beat.passes && (
            <MenuButton
              label={t("tutorial.pass")}
              variant="secondary"
              onPress={() => submitPass(beat)}
              icon={<Ionicons name="hand-left-outline" size={18} color={Colors.gold} />}
            />
          )}
          {!beatDone ? (
            <MenuButton
              label={t("tutorial.playCombination")}
              onPress={() => submitPlay(beat)}
              disabled={selectedIds.size === 0 || (!!beat.staged && !staged.playable)}
              icon={<Ionicons name="play" size={18} color={Colors.bg} />}
            />
          ) : (
            <MenuButton
              label={t("tutorial.continue")}
              onPress={goNext}
              icon={<Ionicons name="arrow-forward" size={18} color={Colors.bg} />}
            />
          )}
        </>
      );
    }

    // exchange
    const winnerHand = beat.state.players[beat.state.exchangePhase.winnerIdx].hand;
    const receivedId = beat.state.exchangePhase.cardFromLoser.id;
    return (
      <>
        <MenuCard title={beat.title}>
          <Text style={styles.instruction}>{beat.instruction}</Text>
          <View style={styles.tipBox}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.gold} {...a11yHidden()} />
            <Text style={styles.tipText}>{beat.tip}</Text>
          </View>
        </MenuCard>

        <MenuCard title={t("tutorial.yourHandAfterReceiving")}>
          <View style={styles.cardRow}>
            {winnerHand.map((c) => {
              const isReceived = c.id === receivedId;
              return (
                <View key={c.id} style={styles.exchangeCardWrap}>
                  <TutorialCard
                    card={c}
                    selected={selectedIds.has(c.id)}
                    disabled={beatDone || isReceived}
                    onPress={isReceived ? undefined : () => toggleCard(c, true)}
                  />
                  {isReceived && <Text style={styles.receivedLabel}>{t("tutorial.justReceived")}</Text>}
                </View>
              );
            })}
          </View>
        </MenuCard>

        <FeedbackBox feedback={feedback} />

        {!beatDone ? (
          <MenuButton
            label={t("tutorial.giveback")}
            onPress={() => submitExchange(beat)}
            disabled={selectedIds.size === 0}
            icon={<Ionicons name="swap-horizontal" size={18} color={Colors.bg} />}
          />
        ) : (
          <MenuButton label={t("tutorial.continue")} onPress={goNext} icon={<Ionicons name="arrow-forward" size={18} color={Colors.bg} />} />
        )}
      </>
    );
  }

  return (
    <MenuLayout scrollable centered={false}>
      {header}
      <Animated.View
        key={stepIndex}
        entering={reduceMotion ? undefined : FadeIn.duration(Motion.duration.travel)}
        style={styles.body}
      >
        {renderBody()}

        {(beat.kind === "info" || beat.kind === "complete") && (
          <MenuButton
            label={beat.cta}
            onPress={goNext}
            icon={<Ionicons name={beat.kind === "complete" ? "game-controller" : "arrow-forward"} size={18} color={Colors.bg} />}
          />
        )}

        {beat.kind === "complete" && (
          <View style={styles.postCompleteRow}>
            <MenuButton label={t("tutorial.rereadRules")} variant="secondary" onPress={() => router.push("/rules")} />
            <MenuButton label={t("tutorial.backToHome")} variant="ghost" onPress={() => router.replace("/")} />
          </View>
        )}
      </Animated.View>
    </MenuLayout>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  // Its own box is the target, matching IconButton opposite it: react-native-web
  // reads hitSlop on nothing but the legacy Touchable.
  skipBtn: {
    minWidth: TOUCH_TARGET_MIN,
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
  progressWrap: { flex: 1, alignItems: "center", gap: Spacing.xxs },
  progressTrack: {
    width: "100%",
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.border,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: Radius.full,
    backgroundColor: Colors.gold,
  },
  progressText: {
    ...Type.caption,
    letterSpacing: 1,
  },
  skipText: {
    ...Type.label,
    color: Colors.gold,
  },

  body: { width: "100%", maxWidth: 560, alignSelf: "center", gap: 0 },

  beatTitle: { ...Type.heading, marginBottom: Spacing.sm },
  paragraph: { ...Type.body, marginBottom: Spacing.sm, lineHeight: 20 },
  instruction: { ...Type.body, color: Colors.text, lineHeight: 20 },

  tipBox: {
    flexDirection: "row",
    gap: Spacing.sm,
    backgroundColor: Colors.goldMuted,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginTop: Spacing.sm,
    alignItems: "flex-start",
  },
  tipText: { ...Type.caption, color: Colors.text, flex: 1, lineHeight: 16 },

  cardRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  clockRow: { alignItems: "flex-start", marginTop: Spacing.sm },
  stagedText: { ...Type.caption, color: Colors.dangerDim, marginTop: Spacing.sm },
  stagedReady: { color: Colors.accent },

  highlightRing: {
    borderWidth: 2,
    borderColor: Colors.gold,
    borderRadius: Radius.md,
    padding: Spacing.xxs,
  },

  exchangeCardWrap: { alignItems: "center", gap: Spacing.xs },
  receivedLabel: { ...Type.caption, fontSize: FontSize.xs, textAlign: "center", maxWidth: 60 },

  feedbackBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
  },
  feedbackOk: { backgroundColor: Colors.accentMuted, borderColor: Colors.accent },
  feedbackError: { backgroundColor: Colors.redMuted, borderColor: Colors.dangerDim },
  feedbackText: { ...Type.body, flex: 1, lineHeight: 18 },

  postCompleteRow: { gap: Spacing.xs, marginTop: Spacing.sm },
});
