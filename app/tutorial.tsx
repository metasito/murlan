import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, { FadeIn } from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import { hapticError, hapticLight, hapticSelection, hapticSuccess } from "@/lib/haptics";
import { Colors, Spacing, Radius, FontSize, Type, Motion } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { markTutorialSeen } from "@/lib/tutorialSeen";
import { useAuth } from "@/context/AuthContext";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { CardView } from "@/components/CardView";
import {
  Card,
  Suit,
  Rank,
  Combination,
  CombinationType,
  GameState,
  buildCombination,
  canPlay,
  getCardDisplayRank,
  getSuitSymbol,
  getValidGivebackCards,
  processExchangeChoice,
} from "@/lib/gameEngine";
import { useTranslation, type TranslationKey, type TranslationParams } from "@/lib/i18n";
import { a11yHidden } from "@/lib/a11y";

type TFn = (key: TranslationKey, params?: TranslationParams) => string;

// ─── Storage keys ──────────────────────────────────────────────────────────
// "Has the tutorial ever been offered" is lib/tutorialSeen.ts's question, and
// it is answered on mount, because every way out of this screen except two —
// the back gesture, the header chevron, the two rows on the last beat —
// leaves no other moment to write it in.
//
// Independent of that: where to resume, cleared only when the player is
// deliberately done (skip, or the final beat).
const PROGRESS_KEY = "@murlan_tutorial_progress";

// ─── Fixed, seeded cards ────────────────────────────────────────────────────
// The tutorial never uses the random dealer: every card below is a literal,
// deterministic Card so every step always matches what the player is holding.
// IDs only need to be unique within the single beat they appear in together
// (hand + table are never rendered from two different beats at once), so the
// same rank/suit is reused across unrelated beats without any ambiguity.
function mk(rank: Exclude<Rank, "joker_bw" | "joker_colored">, suit: Suit): Card {
  return { id: `${rank}_${suit}`, suit, rank, isJoker: false };
}
const JOKER_COLORED: Card = { id: "joker_colored", suit: null, rank: "joker_colored", isJoker: true };

const TYPE_LABEL_KEYS: Record<CombinationType, TranslationKey> = {
  single: "tutorial.typeSingle",
  pair: "tutorial.typePair",
  triple: "tutorial.typeTriple",
  straight: "tutorial.typeStraight",
  bomb: "tutorial.typeBomb",
  royal_straight: "tutorial.typeRoyalStraight",
};

// ─── Beat model ─────────────────────────────────────────────────────────────
// `InfoBeat` and `CompleteBeat` are structurally identical but kept as two
// interfaces (each with a single-literal `kind`) rather than one interface
// with a `"info" | "complete"` union tag — a union-valued discriminant
// defeats TypeScript's discriminated-union narrowing on the `kind` switch
// below, since exhaustive exclusion requires one literal tag per member.
interface InfoBeat {
  kind: "info";
  id: string;
  title: string;
  body: string[];
  cta: string;
}

interface CompleteBeat {
  kind: "complete";
  id: string;
  title: string;
  body: string[];
  cta: string;
}

interface PlayBeat {
  kind: "play";
  id: string;
  title: string;
  instruction: string;
  tip?: string;
  handCards: Card[];
  lastPlayed: Combination | null;
  isNewRound: boolean;
  requireCard?: Card;
  expectedType: CombinationType;
  highlightIds: string[];
  opponentLabel?: string;
  successNarrative: string;
}

interface ExchangeBeat {
  kind: "exchange";
  id: string;
  title: string;
  instruction: string;
  tip: string;
  state: GameState;
  successNarrative: string;
}

type Beat = InfoBeat | PlayBeat | ExchangeBeat | CompleteBeat;

// ─── The script ─────────────────────────────────────────────────────────────

const threeSpades = mk("3", "spades");

const respondLastPlayed = buildCombination([mk("6", "spades")])!;

const bombLastPlayed = buildCombination([
  mk("7", "diamonds"),
  mk("8", "spades"),
  mk("9", "hearts"),
  mk("10", "clubs"),
  mk("J", "diamonds"),
])!;

const royalLastPlayed = buildCombination([
  mk("5", "spades"),
  mk("5", "hearts"),
  mk("5", "diamonds"),
  mk("5", "clubs"),
])!;

const exchangeWinnerCard = mk("5", "diamonds");
const exchangeDeadCard = mk("K", "clubs");
const exchangeThreeHearts = mk("3", "hearts");
// A function, not a module-level constant: the player's own display name
// ("Tu") is translated, so it has to be rebuilt with the current `t` on
// every render rather than frozen at import time (before the device locale
// is even known).
function buildExchangeState(t: TFn): GameState {
  return {
    players: [
      {
        id: "player_0",
        name: t("tutorial.you"),
        hand: [JOKER_COLORED, exchangeWinnerCard, exchangeDeadCard, exchangeThreeHearts],
        type: "human",
      },
      {
        id: "player_1",
        name: "Dea",
        hand: [mk("4", "spades"), mk("7", "spades")],
        type: "ai",
      },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
    exchangePhase: {
      active: true,
      winnerIdx: 0,
      loserIdx: 1,
      cardFromLoser: JOKER_COLORED,
      bothJokersException: false,
    },
  };
}

// Built with the current `t` on every render (via useMemo in the screen
// component) rather than frozen at import time, so every string — including
// the AI's reported moves and the success narratives — follows a live
// language change with no app restart.
function buildBeats(t: TFn): Beat[] {
  return [
    {
      kind: "info",
      id: "welcome",
      title: t("tutorial.beat.welcome.title"),
      body: [
        t("tutorial.beat.welcome.body1"),
        t("tutorial.beat.welcome.body2"),
        t("tutorial.beat.welcome.body3"),
      ],
      cta: t("tutorial.beat.welcome.cta"),
    },
    {
      kind: "play",
      id: "open",
      title: t("tutorial.beat.open.title"),
      instruction: t("tutorial.beat.open.instruction"),
      handCards: [threeSpades, mk("4", "diamonds"), mk("7", "hearts")],
      lastPlayed: null,
      isNewRound: true,
      requireCard: threeSpades,
      expectedType: "single",
      highlightIds: [threeSpades.id],
      successNarrative: t("tutorial.beat.open.successNarrative"),
    },
    {
      kind: "play",
      id: "respond",
      title: t("tutorial.beat.respond.title"),
      instruction: t("tutorial.beat.respond.instruction"),
      tip: t("tutorial.beat.respond.tip"),
      handCards: [mk("5", "hearts"), mk("6", "hearts"), mk("9", "clubs"), mk("2", "diamonds")],
      lastPlayed: respondLastPlayed,
      isNewRound: false,
      expectedType: "single",
      highlightIds: [],
      opponentLabel: t("tutorial.beat.respond.opponentLabel"),
      successNarrative: t("tutorial.beat.respond.successNarrative"),
    },
    {
      kind: "play",
      id: "pair",
      title: t("tutorial.beat.pair.title"),
      instruction: t("tutorial.beat.pair.instruction"),
      handCards: [mk("8", "hearts"), mk("8", "diamonds"), mk("5", "clubs"), mk("4", "clubs")],
      lastPlayed: null,
      isNewRound: true,
      expectedType: "pair",
      highlightIds: [],
      successNarrative: t("tutorial.beat.pair.successNarrative"),
    },
    {
      kind: "play",
      id: "triple",
      title: t("tutorial.beat.triple.title"),
      instruction: t("tutorial.beat.triple.instruction"),
      handCards: [mk("J", "clubs"), mk("J", "diamonds"), mk("J", "hearts"), mk("3", "diamonds"), mk("6", "clubs")],
      lastPlayed: null,
      isNewRound: true,
      expectedType: "triple",
      highlightIds: [],
      successNarrative: t("tutorial.beat.triple.successNarrative"),
    },
    {
      kind: "play",
      id: "straight",
      title: t("tutorial.beat.straight.title"),
      instruction: t("tutorial.beat.straight.instruction"),
      handCards: [
        mk("5", "spades"),
        mk("6", "diamonds"),
        mk("7", "clubs"),
        mk("8", "clubs"),
        mk("9", "diamonds"),
        mk("2", "clubs"),
      ],
      lastPlayed: null,
      isNewRound: true,
      expectedType: "straight",
      highlightIds: [],
      successNarrative: t("tutorial.beat.straight.successNarrative"),
    },
    {
      kind: "play",
      id: "bomb",
      title: t("tutorial.beat.bomb.title"),
      instruction: t("tutorial.beat.bomb.instruction"),
      tip: t("tutorial.beat.bomb.tip"),
      handCards: [mk("K", "spades"), mk("K", "hearts"), mk("K", "diamonds"), mk("K", "clubs"), mk("A", "clubs")],
      lastPlayed: bombLastPlayed,
      isNewRound: false,
      expectedType: "bomb",
      highlightIds: [],
      opponentLabel: t("tutorial.beat.bomb.opponentLabel"),
      successNarrative: t("tutorial.beat.bomb.successNarrative"),
    },
    {
      kind: "play",
      id: "royal",
      title: t("tutorial.beat.royal.title"),
      instruction: t("tutorial.beat.royal.instruction"),
      tip: t("tutorial.beat.royal.tip"),
      handCards: [
        mk("8", "spades"),
        mk("9", "spades"),
        mk("10", "spades"),
        mk("J", "spades"),
        mk("Q", "spades"),
        mk("Q", "hearts"),
      ],
      lastPlayed: royalLastPlayed,
      isNewRound: false,
      expectedType: "royal_straight",
      highlightIds: [],
      opponentLabel: t("tutorial.beat.royal.opponentLabel"),
      successNarrative: t("tutorial.beat.royal.successNarrative"),
    },
    {
      kind: "exchange",
      id: "exchange",
      title: t("tutorial.beat.exchange.title"),
      instruction: t("tutorial.beat.exchange.instruction"),
      tip: t("tutorial.beat.exchange.tip"),
      state: buildExchangeState(t),
      successNarrative: t("tutorial.beat.exchange.successNarrative"),
    },
    {
      kind: "complete",
      id: "done",
      title: t("tutorial.beat.done.title"),
      body: [
        t("tutorial.beat.done.body1"),
        t("tutorial.beat.done.body2"),
        t("tutorial.beat.done.body3"),
      ],
      cta: t("tutorial.beat.done.cta"),
    },
  ];
}

// ─── Engine-backed validation ───────────────────────────────────────────────
// Every legality check below goes through lib/gameEngine.ts — the tutorial can
// never accept (or reject) a move the real game engine wouldn't.

function evaluatePlay(selected: Card[], beat: PlayBeat, t: TFn): { ok: boolean; message: string } {
  if (selected.length === 0) {
    return { ok: false, message: t("tutorial.errSelectAtLeastOne") };
  }

  const combo = buildCombination(selected);
  if (!combo) {
    return { ok: false, message: t("tutorial.errNotAValidCombo") };
  }

  if (beat.requireCard && !selected.some((c) => c.id === beat.requireCard!.id)) {
    return {
      ok: false,
      message: t("tutorial.errMustIncludeCard", {
        rank: getCardDisplayRank(beat.requireCard.rank),
        suit: getSuitSymbol(beat.requireCard.suit),
      }),
    };
  }

  const legal = canPlay(combo, beat.isNewRound ? null : beat.lastPlayed);
  if (!legal) {
    const lp = beat.lastPlayed;
    if (lp?.type === "royal_straight") {
      return { ok: false, message: t("tutorial.errRoyalBeatsAll") };
    }
    if (lp?.type === "bomb" && combo.type !== "bomb") {
      return { ok: false, message: t("tutorial.errOnlyHigherBomb") };
    }
    if (lp && combo.type !== lp.type) {
      return { ok: false, message: t("tutorial.errSameType") };
    }
    if (lp && combo.cards.length !== lp.cards.length) {
      return { ok: false, message: t("tutorial.errSameLength") };
    }
    return { ok: false, message: t("tutorial.errTooWeak") };
  }

  if (combo.type !== beat.expectedType) {
    return {
      ok: false,
      message: t("tutorial.errWrongExpectedType", { type: t(TYPE_LABEL_KEYS[beat.expectedType]) }),
    };
  }

  return { ok: true, message: beat.successNarrative };
}

function evaluateExchange(selected: Card, beat: ExchangeBeat, t: TFn): { ok: boolean; message: string } {
  const winnerHand = beat.state.players[beat.state.exchangePhase!.winnerIdx].hand;
  const valid = getValidGivebackCards(winnerHand, beat.state.exchangePhase!.cardFromLoser.id);
  if (!valid.some((c) => c.id === selected.id)) {
    if (selected.id === beat.state.exchangePhase!.cardFromLoser.id) {
      return { ok: false, message: t("tutorial.errJustReceived") };
    }
    return { ok: false, message: t("tutorial.errExchangeRange") };
  }
  const result = processExchangeChoice(beat.state, selected.id);
  if (result.exchangePhase?.active === false) {
    return { ok: true, message: beat.successNarrative };
  }
  return { ok: false, message: t("tutorial.errExchangeGeneric") };
}

// ─── Screen ─────────────────────────────────────────────────────────────────

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

  // Not until the session has been asked: a player who opens this screen and
  // leaves again before AuthProvider answers would otherwise be recorded on
  // the device only, which is the whole defect on the next phone.
  useEffect(() => {
    if (authLoading) return;
    void markTutorialSeen(userId);
  }, [authLoading, userId]);

  useEffect(() => {
    AsyncStorage.getItem(PROGRESS_KEY)
      .then((raw) => {
        const n = raw ? parseInt(raw, 10) : NaN;
        if (!Number.isNaN(n) && n >= 0 && n < BEATS.length) setStepIndex(n);
      })
      .finally(() => setLoaded(true));
  }, [BEATS.length]);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(PROGRESS_KEY, String(stepIndex)).catch(() => {});
  }, [stepIndex, loaded]);

  useEffect(() => {
    setSelectedIds(new Set());
    setFeedback(null);
    setBeatDone(false);
  }, [stepIndex]);

  if (!loaded) return null;

  const beat = BEATS[stepIndex];
  const isLast = stepIndex === BEATS.length - 1;

  /** Deliberately done with this run, so the next one starts from the top. */
  async function clearProgress() {
    await AsyncStorage.removeItem(PROGRESS_KEY);
  }

  async function handleSkip() {
    hapticLight();
    await clearProgress();
    // The mount effect above waits for the session before recording this, so a
    // player who skips while it is still being asked would land on a home
    // screen that offers the tutorial again. The device half answers now; the
    // account half still follows from the effect.
    await markTutorialSeen(userId);
    router.replace("/");
  }

  function goBack() {
    if (stepIndex > 0) {
      hapticSelection();
      setStepIndex((i) => i - 1);
    } else {
      router.back();
    }
  }

  async function goNext() {
    if (isLast) {
      hapticSuccess();
      await clearProgress();
      router.replace({ pathname: "/lobby", params: { mode: "ai" } });
      return;
    }
    hapticSelection();
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

  function submitPlay(b: PlayBeat) {
    const selected = b.handCards.filter((c) => selectedIds.has(c.id));
    const result = evaluatePlay(selected, b, t);
    setFeedback({ ok: result.ok, text: result.message });
    if (result.ok) {
      hapticSuccess();
      setBeatDone(true);
    } else {
      hapticError();
    }
  }

  function submitExchange(b: ExchangeBeat) {
    const winnerHand = b.state.players[b.state.exchangePhase!.winnerIdx].hand;
    const selected = winnerHand.find((c) => selectedIds.has(c.id));
    if (!selected) {
      setFeedback({ ok: false, text: t("tutorial.errSelectCardToReturn") });
      return;
    }
    const result = evaluateExchange(selected, b, t);
    setFeedback({ ok: result.ok, text: result.message });
    if (result.ok) {
      hapticSuccess();
      setBeatDone(true);
    } else {
      hapticError();
    }
  }

  const header = (
    <View style={styles.header}>
      <Pressable onPress={goBack} style={styles.headerBtn} hitSlop={Spacing.sm} accessibilityRole="button" accessibilityLabel={t("tutorial.backA11yLabel")}>
        {/* The glyph is the button's visual content, not a second control:
            left exposed it focuses separately from the button naming it. */}
        <Ionicons
          name="chevron-back"
          size={22}
          color={Colors.gold}
          {...a11yHidden()}
        />
      </Pressable>
      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((stepIndex + 1) / BEATS.length) * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {t("tutorial.progressText", { current: stepIndex + 1, total: BEATS.length })}
        </Text>
      </View>
      <Pressable onPress={handleSkip} style={styles.headerBtn} hitSlop={Spacing.sm} accessibilityRole="button" accessibilityLabel={t("tutorial.skipA11yLabel")}>
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
          <Text style={styles.beatTitle}>{beat.title}</Text>
          {beat.body.map((p, i) => (
            <Text key={i} style={styles.paragraph}>
              {p}
            </Text>
          ))}
        </MenuCard>
      );
    }

    if (beat.kind === "play") {
      return (
        <>
          <MenuCard title={beat.title}>
            <Text style={styles.instruction}>{beat.instruction}</Text>
            {beat.tip && (
              <View style={styles.tipBox}>
                <Ionicons name="information-circle-outline" size={16} color={Colors.gold} />
                <Text style={styles.tipText}>{beat.tip}</Text>
              </View>
            )}
          </MenuCard>

          {beat.lastPlayed && (
            <MenuCard title={beat.opponentLabel ?? t("tutorial.onTable")}>
              <View style={styles.cardRow}>
                {beat.lastPlayed.cards.map((c) => (
                  <CardView key={c.id} card={c} scale={0.625} compact noLift />
                ))}
              </View>
            </MenuCard>
          )}

          <MenuCard title={t("tutorial.yourHand")}>
            <View style={styles.cardRow}>
              {beat.handCards.map((c) => (
                <CardView
                  key={c.id}
                  card={c}
                  selected={selectedIds.has(c.id)}
                  disabled={beatDone}
                  onPress={() => toggleCard(c, false)}
                  style={beat.highlightIds.includes(c.id) ? styles.highlightRing : undefined}
                />
              ))}
            </View>
          </MenuCard>

          {feedback && (
            <View style={[styles.feedbackBox, feedback.ok ? styles.feedbackOk : styles.feedbackError]}>
              <Ionicons
                name={feedback.ok ? "checkmark-circle" : "close-circle"}
                size={18}
                color={feedback.ok ? Colors.accent : Colors.dangerDim}
              />
              <Text style={[styles.feedbackText, { color: feedback.ok ? Colors.text : Colors.dangerDim }]}>
                {feedback.text}
              </Text>
            </View>
          )}

          {!beatDone ? (
            <MenuButton
              label={t("tutorial.playCombination")}
              onPress={() => submitPlay(beat)}
              disabled={selectedIds.size === 0}
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
    const winnerHand = beat.state.players[beat.state.exchangePhase!.winnerIdx].hand;
    const receivedId = beat.state.exchangePhase!.cardFromLoser.id;
    return (
      <>
        <MenuCard title={beat.title}>
          <Text style={styles.instruction}>{beat.instruction}</Text>
          <View style={styles.tipBox}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.gold} />
            <Text style={styles.tipText}>{beat.tip}</Text>
          </View>
        </MenuCard>

        <MenuCard title={t("tutorial.yourHandAfterReceiving")}>
          <View style={styles.cardRow}>
            {winnerHand.map((c) => {
              const isReceived = c.id === receivedId;
              return (
                <View key={c.id} style={styles.exchangeCardWrap}>
                  <CardView
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

        {feedback && (
          <View style={[styles.feedbackBox, feedback.ok ? styles.feedbackOk : styles.feedbackError]}>
            <Ionicons
              name={feedback.ok ? "checkmark-circle" : "close-circle"}
              size={18}
              color={feedback.ok ? Colors.accent : Colors.dangerDim}
            />
            <Text style={[styles.feedbackText, { color: feedback.ok ? Colors.text : Colors.dangerDim }]}>
              {feedback.text}
            </Text>
          </View>
        )}

        {!beatDone ? (
          <MenuButton
            label={t("tutorial.returnCard")}
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
        entering={reduceMotion ? undefined : FadeIn.duration(Motion.duration.moderate)}
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
  headerBtn: {
    width: 40,
    height: 40,
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
