import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";

interface FAQ {
  question: string;
  answer: string;
}

const FAQS: FAQ[] = [
  {
    question: "Qual è l'obiettivo del gioco?",
    answer:
      "Essere il primo giocatore (o coppia) a rimanere senza carte. Il gioco continua fino a quando tutti i giocatori tranne l'ultimo hanno terminato le carte.",
  },
  {
    question: "Chi inizia per primo?",
    answer:
      "Il giocatore che ha il 3 di cuori (♥3) inizia sempre per primo e deve giocare quella carta come prima mossa. Il giro prosegue in senso orario.",
  },
  {
    question: "Qual è la forza delle carte?",
    answer:
      "Dalla più forte alla più debole:\n★ Joker Colorato > ☆ Joker B/N > 2 > A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3\n\nIl 2 è la carta regolare più forte del mazzo!",
  },
  {
    question: "Quali combinazioni posso giocare?",
    answer:
      "• Carta singola: una qualsiasi carta\n• Coppia: due carte dello stesso valore\n• Tris: tre carte dello stesso valore\n• Scala: tre o più carte consecutive (es. 7-8-9 o J-Q-K). Il 2 NON può essere usato nelle scale.",
  },
  {
    question: "Come funzionano i turni?",
    answer:
      "Devi giocare la stessa tipo di combinazione del giocatore precedente, ma di valore superiore. Oppure puoi passare il tuo turno.\n\nEsempio: se viene giocata una coppia di 9, puoi rispondere solo con una coppia di valore superiore (10, J, Q, K, A, 2 o Joker).",
  },
  {
    question: "Quando si vince un round?",
    answer:
      "Quando tutti i giocatori passano consecutivamente (tranne uno), chi ha giocato l'ultima combinazione vince il round. Questo giocatore inizia un nuovo round con qualsiasi combinazione.",
  },
  {
    question: "Cosa sono i Joker?",
    answer:
      "I Joker sono le carte più forti del mazzo:\n• Joker Colorato ★: il più forte in assoluto\n• Joker B/N ☆: secondo per forza\n\nI Joker battono qualsiasi altra carta, incluso il 2.",
  },
  {
    question: "Come funziona la modalità a coppie?",
    answer:
      "Con 4 giocatori puoi giocare a coppie:\n• Team A: Giocatore 1 & 3\n• Team B: Giocatore 2 & 4\n\nVince la coppia il cui primo membro termina le carte. I compagni non possono comunicare o vedere le carte degli altri.",
  },
  {
    question: "Posso passare quando voglio?",
    answer:
      "Puoi passare solo se c'è una combinazione attiva sul tavolo. Se sei il primo a giocare nel round (o hai vinto il round precedente), DEVI giocare una combinazione, non puoi passare.",
  },
  {
    question: "Quante carte si distribuiscono?",
    answer:
      "• 2 giocatori: 26 carte ciascuno (mazzo completo)\n• 3 giocatori: 17 carte ciascuno (1 carta esclusa dal gioco)\n• 4 giocatori: 13 carte ciascuno",
  },
  {
    question: "Come funziona l'AI?",
    answer:
      "L'AI ha tre livelli:\n• Facile: gioca la prima combinazione valida\n• Medio: gioca sempre la combinazione più bassa possibile per conservare le carte forti\n• Difficile: usa una strategia avanzata, conserva il 2 e i Joker, e diventa aggressiva quando gli avversari sono vicini a vincere",
  },
  {
    question: "Il gioco finisce subito quando termino le mie carte?",
    answer:
      "No! Se ci sono altri giocatori, il gioco continua tra di loro. Tu aspetti semplicemente che finiscano. Puoi vedere le posizioni finali nella schermata dei risultati (1°, 2°, 3°, 4°).",
  },
];

function FAQItem({ item, isLast }: { item: FAQ; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const height = useSharedValue(0);
  const opacity = useSharedValue(0);

  const toggleOpen = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    height.value = withTiming(nextOpen ? 1 : 0, { duration: 280 });
    opacity.value = withTiming(nextOpen ? 1 : 0, { duration: 200 });
  };

  const answerStyle = useAnimatedStyle(() => ({
    maxHeight: height.value * 400,
    opacity: opacity.value,
    overflow: "hidden",
  }));

  return (
    <View style={[styles.faqItem, isLast && styles.faqItemLast]}>
      <Pressable onPress={toggleOpen} style={styles.faqQuestion}>
        <Text style={styles.faqQuestionText}>{item.question}</Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={Colors.gold}
        />
      </Pressable>
      <Animated.View style={answerStyle}>
        <Text style={styles.faqAnswer}>{item.answer}</Text>
      </Animated.View>
    </View>
  );
}

export default function RulesScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <LinearGradient
        colors={[Colors.bg, Colors.bgCard]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={Colors.gold} />
        </Pressable>
        <Text style={styles.headerTitle}>Regole & FAQ</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroBanner}>
          <LinearGradient
            colors={[Colors.bgSurface, Colors.bgElevated]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroSuits}>
            {["♠", "♥", "♦", "♣"].map((s, i) => (
              <Text
                key={s}
                style={[styles.heroSuit, { color: i % 2 === 0 ? Colors.textMuted : Colors.red }]}
              >
                {s}
              </Text>
            ))}
          </View>
          <Text style={styles.heroTitle}>MURLAN</Text>
          <Text style={styles.heroSubtitle}>Guida al Gioco</Text>
        </View>

        <View style={styles.quickRef}>
          <Text style={styles.sectionLabel}>FORZA CARTE (più forte → più debole)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strengthRow}>
            {[
              { rank: "JKR★", color: "#C0392B", label: "Joker Col." },
              { rank: "JKR☆", color: "#555", label: "Joker B/N" },
              { rank: "2", color: Colors.text, label: "Due" },
              { rank: "A", color: Colors.text, label: "Asso" },
              { rank: "K", color: Colors.text, label: "Re" },
              { rank: "Q", color: Colors.text, label: "Regina" },
              { rank: "J", color: Colors.text, label: "Fante" },
              { rank: "10", color: Colors.text, label: "Dieci" },
              { rank: "3", color: Colors.textMuted, label: "Tre" },
            ].map((item) => (
              <View key={item.rank} style={styles.strengthCard}>
                <Text style={[styles.strengthRank, { color: item.color }]}>{item.rank}</Text>
                <Text style={styles.strengthLabel}>{item.label}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.combosSection}>
          <Text style={styles.sectionLabel}>COMBINAZIONI VALIDE</Text>
          <View style={styles.comboGrid}>
            {[
              { name: "Singola", desc: "1 carta qualsiasi", icon: "card" },
              { name: "Coppia", desc: "2 carte stessa forza", icon: "copy" },
              { name: "Tris", desc: "3 carte stessa forza", icon: "layers" },
              { name: "Scala", desc: "3+ carte consecutive", icon: "trending-up" },
            ].map((c) => (
              <View key={c.name} style={styles.comboCard}>
                <Ionicons
                  name={c.icon as React.ComponentProps<typeof Ionicons>["name"]}
                  size={22}
                  color={Colors.gold}
                />
                <Text style={styles.comboName}>{c.name}</Text>
                <Text style={styles.comboDesc}>{c.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.faqSection}>
          <Text style={styles.sectionLabel}>DOMANDE FREQUENTI</Text>
          <View style={styles.faqList}>
            {FAQS.map((item, i) => (
              <FAQItem key={i} item={item} isLast={i === FAQS.length - 1} />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 20,
    color: Colors.text,
    letterSpacing: 1,
  },

  scroll: {
    padding: 20,
    gap: 24,
  },

  heroBanner: {
    borderRadius: 16,
    overflow: "hidden",
    padding: 24,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroSuits: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
  },
  heroSuit: {
    fontSize: 20,
    opacity: 0.8,
  },
  heroTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 36,
    color: Colors.text,
    letterSpacing: 8,
  },
  heroSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.gold,
    letterSpacing: 3,
    textTransform: "uppercase",
  },

  quickRef: {
    gap: 12,
  },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: Colors.textMuted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  strengthRow: {
    gap: 8,
    paddingVertical: 4,
  },
  strengthCard: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    gap: 4,
    minWidth: 58,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  strengthRank: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 16,
  },
  strengthLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 9,
    color: Colors.textMuted,
    textAlign: "center",
  },

  combosSection: {
    gap: 12,
  },
  comboGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  comboCard: {
    flex: 1,
    minWidth: "44%",
    backgroundColor: Colors.bgSurface,
    borderRadius: 12,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "flex-start",
  },
  comboName: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 15,
    color: Colors.text,
  },
  comboDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 16,
  },

  faqSection: {
    gap: 12,
  },
  faqList: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  faqItem: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
  },
  faqItemLast: {
    borderBottomWidth: 0,
  },
  faqQuestion: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    gap: 12,
  },
  faqQuestionText: {
    flex: 1,
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 15,
    color: Colors.text,
    lineHeight: 20,
  },
  faqAnswer: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20,
    paddingBottom: 14,
  },
});
