import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, { FadeIn } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors, Spacing, Radius, FontSize, Type, Motion } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
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

// ─── Storage keys ──────────────────────────────────────────────────────────
const SEEN_KEY = "@murlan_tutorial_seen";
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

const TYPE_LABEL: Record<CombinationType, string> = {
  single: "una Singola",
  pair: "una Coppia",
  triple: "un Tris",
  straight: "una Scala",
  bomb: "una Bomba",
  royal_straight: "una Scala Reale",
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
const exchangeState: GameState = {
  players: [
    {
      id: "player_0",
      name: "Tu",
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

const BEATS: Beat[] = [
  {
    kind: "info",
    id: "welcome",
    title: "Benvenuto a Murlan!",
    body: [
      "Murlan è un gioco di carte di origine albanese per 2-4 giocatori. L'obiettivo: rimanere senza carte in mano per primi.",
      "A ogni turno giochi una combinazione di carte più forte di quella sul tavolo, oppure passi. Chi fa passare tutti gli altri vince il turno e ne apre uno nuovo, con la combinazione che preferisce.",
      "Impariamo giocando: userai una mano di carte già decisa contro Dea, un'avversaria di prova. Ogni mossa che proverai viene controllata dalle stesse regole della partita vera.",
    ],
    cta: "Inizia",
  },
  {
    kind: "play",
    id: "open",
    title: "La prima giocata",
    instruction:
      "La primissima mano di ogni partita comincia sempre con chi ha il 3 di Picche (3♠), e questa carta deve far parte della giocata. Selezionalo e gioca.",
    handCards: [threeSpades, mk("4", "diamonds"), mk("7", "hearts")],
    lastPlayed: null,
    isNewRound: true,
    requireCard: threeSpades,
    expectedType: "single",
    highlightIds: [threeSpades.id],
    successNarrative:
      "Perfetto! Dea non ha interesse a rispondere così presto con una carta forte: passa. Hai vinto il turno.",
  },
  {
    kind: "play",
    id: "respond",
    title: "Rispondere a una carta",
    instruction: "Dea apre il turno successivo con un 6♠. Per batterla ti serve una carta singola più forte.",
    tip: "Ricorda: serve una carta STRETTAMENTE più forte. Una carta dello stesso valore non basta.",
    handCards: [mk("5", "hearts"), mk("6", "hearts"), mk("9", "clubs"), mk("2", "diamonds")],
    lastPlayed: respondLastPlayed,
    isNewRound: false,
    expectedType: "single",
    highlightIds: [],
    opponentLabel: "Dea ha giocato: 6♠",
    successNarrative: "Ottimo! Hai risposto con una carta più forte. Hai vinto il turno.",
  },
  {
    kind: "play",
    id: "pair",
    title: "Coppie",
    instruction:
      "Hai vinto l'ultimo turno: ora tocca a te decidere cosa giocare, con qualsiasi combinazione. Prova una Coppia: due carte dello stesso valore.",
    handCards: [mk("8", "hearts"), mk("8", "diamonds"), mk("5", "clubs"), mk("4", "clubs")],
    lastPlayed: null,
    isNewRound: true,
    expectedType: "pair",
    highlightIds: [],
    successNarrative: "Coppia di 8! Dea passa: non ha una coppia più alta pronta.",
  },
  {
    kind: "play",
    id: "triple",
    title: "Tris",
    instruction: "Un'altra vittoria, un'altra scelta libera. Prova un Tris: tre carte dello stesso valore.",
    handCards: [mk("J", "clubs"), mk("J", "diamonds"), mk("J", "hearts"), mk("3", "diamonds"), mk("6", "clubs")],
    lastPlayed: null,
    isNewRound: true,
    expectedType: "triple",
    highlightIds: [],
    successNarrative: "Tris di Fanti! Dea passa di nuovo.",
  },
  {
    kind: "play",
    id: "straight",
    title: "Scale",
    instruction: "Prova una Scala: minimo 5 carte consecutive per valore, di semi qualsiasi.",
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
    successNarrative:
      "Scala centrale (5-9)! Dea non riesce a rispondere in tempo, passa. Nota: il 2 che avevi in mano vale pochissimo dentro una scala — è la carta più bassa di tutte, anche se di solito è la più forte del mazzo! L'Asso invece può stare in fondo (prima del 2) o in cima (dopo il Re): una scala può arrivare fino a 13 carte.",
  },
  {
    kind: "play",
    id: "bomb",
    title: "La Bomba",
    instruction:
      "Questa volta apre Dea, con una Scala fortissima. Sembra imbattibile... ma tu hai qualcosa di speciale in mano.",
    tip: "Una Bomba (4 carte dello stesso valore) batte qualsiasi Singola, Coppia, Tris o Scala, indipendentemente da quanto siano forti.",
    handCards: [mk("K", "spades"), mk("K", "hearts"), mk("K", "diamonds"), mk("K", "clubs"), mk("A", "clubs")],
    lastPlayed: bombLastPlayed,
    isNewRound: false,
    expectedType: "bomb",
    highlightIds: [],
    opponentLabel: "Dea ha giocato: Scala 7-J",
    successNarrative: "BOMBA! Quattro Re spazzano via la scala di Dea. Vinci il turno alla grande.",
  },
  {
    kind: "play",
    id: "royal",
    title: "La Scala Reale",
    instruction:
      "Dea rilancia con una Bomba di 5: sembra inarrestabile. C'è solo una cosa al mondo che la batte.",
    tip: "La Scala Reale — una scala con tutte le carte dello stesso seme — batte anche la Bomba più forte. È la combinazione più potente del gioco (una regola non tradizionale, adottata in questa versione).",
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
    opponentLabel: "Dea ha giocato: Bomba di 5",
    successNarrative: "SCALA REALE di Picche! Nulla può batterla. Turno vinto in grande stile.",
  },
  {
    kind: "exchange",
    id: "exchange",
    title: "Lo scambio di carte",
    instruction:
      "Dopo ogni manche, chi ha vinto e chi ha perso si scambiano una carta. Hai vinto l'ultima manche: chi ha perso ti ha già dato automaticamente la sua carta più forte, il Joker Colorato. Ora scegli tu una carta da restituirgli, di valore compreso tra 3 e 10.",
    tip: "Eccezione dei due Joker: se chi ha perso ha in mano ENTRAMBI i Joker, lo scambio non avviene affatto — mostra semplicemente le due carte, e chi ha vinto apre subito il turno successivo.",
    state: exchangeState,
    successNarrative: "Scambio completato! Chi ha perso la manche precedente apre il turno successivo.",
  },
  {
    kind: "complete",
    id: "done",
    title: "Sei pronto!",
    body: [
      "Hai visto tutte le combinazioni — Singola, Coppia, Tris, Scala, Bomba e Scala Reale — oltre all'apertura con il 3♠ e lo scambio di carte a fine manche.",
      "Nella partita vera userai le stesse regole che hai appena provato: il gioco non ti lascerà mai fare una mossa non valida.",
      "Puoi rivedere questo tutorial in qualsiasi momento dalla schermata iniziale, oppure consultare le Regole & FAQ complete.",
    ],
    cta: "Vai alla partita",
  },
];

// ─── Engine-backed validation ───────────────────────────────────────────────
// Every legality check below goes through lib/gameEngine.ts — the tutorial can
// never accept (or reject) a move the real game engine wouldn't.

function evaluatePlay(selected: Card[], beat: PlayBeat): { ok: boolean; message: string } {
  if (selected.length === 0) {
    return { ok: false, message: "Seleziona almeno una carta dalla tua mano." };
  }

  const combo = buildCombination(selected);
  if (!combo) {
    return { ok: false, message: "Queste carte non formano una combinazione valida." };
  }

  if (beat.requireCard && !selected.some((c) => c.id === beat.requireCard!.id)) {
    return {
      ok: false,
      message: `La prima giocata deve includere il ${getCardDisplayRank(beat.requireCard.rank)}${getSuitSymbol(beat.requireCard.suit)}.`,
    };
  }

  const legal = canPlay(combo, beat.isNewRound ? null : beat.lastPlayed);
  if (!legal) {
    const lp = beat.lastPlayed;
    if (lp?.type === "royal_straight") {
      return { ok: false, message: "La Scala Reale batte tutto: qui non puoi rispondere." };
    }
    if (lp?.type === "bomb" && combo.type !== "bomb") {
      return { ok: false, message: "Solo una Bomba più alta può battere questa." };
    }
    if (lp && combo.type !== lp.type) {
      return { ok: false, message: "Devi rispondere con lo stesso tipo di combinazione, oppure passare." };
    }
    if (lp && combo.cards.length !== lp.cards.length) {
      return { ok: false, message: "Deve avere lo stesso numero di carte di quella sul tavolo." };
    }
    return { ok: false, message: "Questa combinazione non è abbastanza forte: serve una carta più alta." };
  }

  if (combo.type !== beat.expectedType) {
    return {
      ok: false,
      message: `Mossa valida, ma in questa lezione proviamo con ${TYPE_LABEL[beat.expectedType]}. Riprova.`,
    };
  }

  return { ok: true, message: beat.successNarrative };
}

function evaluateExchange(selected: Card, beat: ExchangeBeat): { ok: boolean; message: string } {
  const winnerHand = beat.state.players[beat.state.exchangePhase!.winnerIdx].hand;
  const valid = getValidGivebackCards(winnerHand);
  if (!valid.some((c) => c.id === selected.id)) {
    if (selected.id === beat.state.exchangePhase!.cardFromLoser.id) {
      return { ok: false, message: "Quella l'hai appena ricevuta dal perdente: non puoi restituire proprio lei." };
    }
    return { ok: false, message: "Puoi restituire solo una carta di valore compreso tra 3 e 10." };
  }
  const result = processExchangeChoice(beat.state, selected.id);
  if (result.exchangePhase?.active === false) {
    return { ok: true, message: beat.successNarrative };
  }
  return { ok: false, message: "Qualcosa non torna: riprova." };
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function TutorialScreen() {
  const reduceMotion = usePrefersReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [beatDone, setBeatDone] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(PROGRESS_KEY)
      .then((raw) => {
        const n = raw ? parseInt(raw, 10) : NaN;
        if (!Number.isNaN(n) && n >= 0 && n < BEATS.length) setStepIndex(n);
      })
      .finally(() => setLoaded(true));
  }, []);

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

  async function finish() {
    await AsyncStorage.setItem(SEEN_KEY, "1");
    await AsyncStorage.removeItem(PROGRESS_KEY);
  }

  async function handleSkip() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await finish();
    router.replace("/");
  }

  function goBack() {
    if (stepIndex > 0) {
      Haptics.selectionAsync();
      setStepIndex((i) => i - 1);
    } else {
      router.back();
    }
  }

  async function goNext() {
    if (isLast) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await finish();
      router.replace({ pathname: "/lobby", params: { mode: "ai" } });
      return;
    }
    Haptics.selectionAsync();
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
    const result = evaluatePlay(selected, b);
    setFeedback({ ok: result.ok, text: result.message });
    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBeatDone(true);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  function submitExchange(b: ExchangeBeat) {
    const winnerHand = b.state.players[b.state.exchangePhase!.winnerIdx].hand;
    const selected = winnerHand.find((c) => selectedIds.has(c.id));
    if (!selected) {
      setFeedback({ ok: false, text: "Seleziona una carta da restituire." });
      return;
    }
    const result = evaluateExchange(selected, b);
    setFeedback({ ok: result.ok, text: result.message });
    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBeatDone(true);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  const header = (
    <View style={styles.header}>
      <Pressable onPress={goBack} style={styles.headerBtn} hitSlop={Spacing.sm} accessibilityRole="button" accessibilityLabel="Indietro">
        <Ionicons name="chevron-back" size={22} color={Colors.gold} />
      </Pressable>
      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((stepIndex + 1) / BEATS.length) * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {stepIndex + 1} / {BEATS.length}
        </Text>
      </View>
      <Pressable onPress={handleSkip} style={styles.headerBtn} hitSlop={Spacing.sm} accessibilityRole="button" accessibilityLabel="Salta il tutorial">
        <Text style={styles.skipText}>Salta</Text>
      </Pressable>
    </View>
  );

  function renderBody() {
    if (beat.kind === "info" || beat.kind === "complete") {
      return (
        <MenuCard title={beat.kind === "complete" ? "Tutorial completato" : "Guida rapida"}>
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
            <MenuCard title={beat.opponentLabel ?? "Sul tavolo"}>
              <View style={styles.cardRow}>
                {beat.lastPlayed.cards.map((c) => (
                  <CardView key={c.id} card={c} small noLift />
                ))}
              </View>
            </MenuCard>
          )}

          <MenuCard title="La tua mano">
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
              label="Gioca la combinazione"
              onPress={() => submitPlay(beat)}
              disabled={selectedIds.size === 0}
              icon={<Ionicons name="play" size={18} color={Colors.bg} />}
            />
          ) : (
            <MenuButton
              label={isLast ? "Continua" : "Continua"}
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

        <MenuCard title="La tua mano (dopo aver ricevuto la carta)">
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
                  {isReceived && <Text style={styles.receivedLabel}>appena ricevuta</Text>}
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
            label="Restituisci carta"
            onPress={() => submitExchange(beat)}
            disabled={selectedIds.size === 0}
            icon={<Ionicons name="swap-horizontal" size={18} color={Colors.bg} />}
          />
        ) : (
          <MenuButton label="Continua" onPress={goNext} icon={<Ionicons name="arrow-forward" size={18} color={Colors.bg} />} />
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
            <MenuButton label="Rileggi le Regole & FAQ" variant="secondary" onPress={() => router.push("/rules")} />
            <MenuButton label="Torna alla Home" variant="ghost" onPress={() => router.replace("/")} />
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
  progressWrap: { flex: 1, alignItems: "center", gap: 2 },
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
    padding: 2,
  },

  exchangeCardWrap: { alignItems: "center", gap: 4 },
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
