import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Platform,
  useWindowDimensions,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useGame, PlayerSetupConfig } from "@/context/GameContext";
import { useAuth } from "@/context/AuthContext";
import { GameMode, AIDifficulty } from "@/lib/gameEngine";
import { Colors } from '@/lib/theme';

type LobbyMode = "ai" | "local";

interface PlayerRowProps {
  index: number;
  config: PlayerSetupConfig;
  onChange: (config: PlayerSetupConfig) => void;
  isHuman?: boolean;
  lobbyMode: LobbyMode;
}

const DIFFICULTY_LABELS: Record<AIDifficulty, string> = {
  easy: "Facile",
  medium: "Medio",
  hard: "Difficile",
};

function PlayerRow({ index, config, onChange, isHuman, lobbyMode }: PlayerRowProps) {
  const isAI = config.type === "ai";

  const cycleDifficulty = () => {
    const levels: AIDifficulty[] = ["easy", "medium", "hard"];
    const current = config.difficulty ?? "medium";
    const next = levels[(levels.indexOf(current) + 1) % levels.length];
    onChange({ ...config, difficulty: next });
    Haptics.selectionAsync();
  };

  const teamColors = { A: Colors.accent, B: Colors.gold };
  const teamLabel = config.team ? `Team ${config.team}` : null;

  return (
    <View style={styles.playerRow}>
      <View style={styles.playerAvatar}>
        <LinearGradient
          colors={
            isHuman
              ? [Colors.gold, Colors.goldDark]
              : [Colors.bgElevated, Colors.bgSurface]
          }
          style={styles.avatarGradient}
        >
          <Ionicons
            name={isHuman ? "person" : "hardware-chip"}
            size={18}
            color={isHuman ? "#0A1F18" : Colors.textSecondary}
          />
        </LinearGradient>
      </View>

      <View style={styles.playerInfo}>
        {lobbyMode === "local" && !isHuman ? (
          <TextInput
            value={config.name}
            onChangeText={(t) => onChange({ ...config, name: t })}
            style={styles.nameInput}
            placeholderTextColor={Colors.textMuted}
            maxLength={12}
            accessibilityLabel="Nome giocatore intelligente"
            accessibilityHint="Inserisci il nome per questo giocatore controllato dal computer"
          />
        ) : (
          <Text style={styles.playerName}>{config.name}</Text>
        )}
        {teamLabel && (
          <Text
            style={[
              styles.teamBadge,
              { color: config.team === "A" ? Colors.accent : Colors.gold },
            ]}
          >
            {teamLabel}
          </Text>
        )}
      </View>

      {isAI && (
        <Pressable onPress={cycleDifficulty} style={styles.difficultyBtn}>
          <Text style={styles.difficultyText}>
            {DIFFICULTY_LABELS[config.difficulty ?? "medium"]}
          </Text>
          <Ionicons name="chevron-down" size={12} color={Colors.gold} />
        </Pressable>
      )}
    </View>
  );
}

const ROUND_OPTIONS = [1, 3, 5, 7];

export default function LobbyScreen() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const isLandscape = W > H;
  const { mode } = useLocalSearchParams<{ mode: LobbyMode }>();
  const { setupGame } = useGame();
  const { user } = useAuth();
  const myName = user?.username ?? "Giocatore 1";

  const isAI = mode === "ai";

  const [playerCount, setPlayerCount] = useState(2);
  const [gameMode, setGameMode] = useState<GameMode>("free_for_all");
  const [totalRounds, setTotalRounds] = useState(1);

  const getTeam = (i: number, count: number, gm: GameMode): "A" | "B" | undefined => {
    if (gm !== "teams" || count !== 4) return undefined;
    return i % 2 === 0 ? "A" : "B";
  };

  const buildDefaultPlayers = (count: number, gm: GameMode): PlayerSetupConfig[] => {
    return Array.from({ length: count }, (_, i) => ({
      name: i === 0 ? myName : isAI ? `AI ${i}` : `Giocatore ${i + 1}`,
      type: i === 0 || !isAI ? "human" : "ai",
      difficulty: "medium" as AIDifficulty,
      team: getTeam(i, count, gm),
    }));
  };

  const [players, setPlayers] = useState<PlayerSetupConfig[]>(
    buildDefaultPlayers(2, "free_for_all")
  );

  useEffect(() => {
    setPlayers((prev) =>
      prev.map((p, i) => (i === 0 ? { ...p, name: myName } : p))
    );
  }, [myName]);

  const handleCountChange = (count: number) => {
    setPlayerCount(count);
    const newMode = count === 4 && gameMode === "teams" ? "teams" : "free_for_all";
    setGameMode(newMode);
    setPlayers(buildDefaultPlayers(count, newMode));
    Haptics.selectionAsync();
  };

  const handleModeChange = (gm: GameMode) => {
    setGameMode(gm);
    setPlayers((prev) =>
      prev.map((p, i) => ({
        ...p,
        team: getTeam(i, playerCount, gm),
      }))
    );
    Haptics.selectionAsync();
  };

  const handlePlayerChange = (index: number, config: PlayerSetupConfig) => {
    setPlayers((prev) => {
      const updated = [...prev];
      updated[index] = config;
      return updated;
    });
  };

  const handleStart = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setupGame(players, gameMode, totalRounds);
    router.replace("/game");
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const leftPad = isLandscape ? (Platform.OS === "web" ? 0 : insets.left) : 0;
  const rightPad = isLandscape ? (Platform.OS === "web" ? 0 : insets.right) : 0;

  const startButton = (
    <Pressable onPress={handleStart} style={styles.startBtn}>
      <LinearGradient
        colors={[Colors.gold, Colors.goldDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.startGradient}
      >
        <Ionicons name="play" size={20} color="#0A1F18" />
        <Text style={styles.startText}>Inizia Partita</Text>
      </LinearGradient>
    </Pressable>
  );

  const configSection = (
    <>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>N° GIOCATORI</Text>
        <View style={styles.countRow}>
          {[2, 3, 4].map((n) => (
            <Pressable key={n} onPress={() => handleCountChange(n)} style={[styles.countBtn, playerCount === n && styles.countBtnActive]}>
              <Text style={[styles.countBtnText, playerCount === n && styles.countBtnTextActive]}>{n}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {playerCount === 4 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>MODALITÀ</Text>
          <View style={styles.modeRow}>
            {(["free_for_all", "teams"] as GameMode[]).map((gm) => (
              <Pressable key={gm} onPress={() => handleModeChange(gm)} style={[styles.modeBtn, gameMode === gm && styles.modeBtnActive]}>
                <Ionicons name={gm === "teams" ? "people" : "person"} size={16} color={gameMode === gm ? Colors.gold : Colors.textSecondary} />
                <Text style={[styles.modeBtnText, gameMode === gm && styles.modeBtnTextActive]}>
                  {gm === "teams" ? "A Coppie" : "Tutti vs Tutti"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>MANCHE</Text>
        <View style={styles.countRow}>
          {ROUND_OPTIONS.map((n) => (
            <Pressable key={n} onPress={() => { setTotalRounds(n); Haptics.selectionAsync(); }} style={[styles.countBtn, totalRounds === n && styles.countBtnActive]}>
              <Text style={[styles.countBtnText, totalRounds === n && styles.countBtnTextActive]}>{n}</Text>
              <Text style={[styles.roundSubLabel, totalRounds === n && { color: Colors.gold }]}>
                {n === 1 ? "partita" : "manche"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </>
  );

  const playerListSection = (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>GIOCATORI</Text>
      <View style={styles.playerList}>
        {players.map((p, i) => (
          <PlayerRow key={i} index={i} config={p} isHuman={p.type === "human"} onChange={(c) => handlePlayerChange(i, c)} lobbyMode={mode ?? "ai"} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingLeft: leftPad, paddingRight: rightPad }]}>
      <LinearGradient colors={[Colors.bg, Colors.bgCard]} style={StyleSheet.absoluteFill} />

      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={Colors.gold} />
        </Pressable>
        <Text style={styles.headerTitle}>{isAI ? "Gioca vs AI" : "Passa e Gioca"}</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLandscape ? (
        <View style={styles.landscapeBody}>
          <View style={styles.landscapeLeftCol}>
            <ScrollView contentContainerStyle={styles.landscapeLeftScroll} showsVerticalScrollIndicator={false}>
              {configSection}
            </ScrollView>
          </View>
          <View style={styles.landscapeRightCol}>
            <ScrollView contentContainerStyle={styles.landscapeRightScroll} showsVerticalScrollIndicator={false}>
              {playerListSection}
            </ScrollView>
            <View style={[styles.landscapeStartWrap, { paddingBottom: bottomPad + 8 }]}>
              {startButton}
            </View>
          </View>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad + 120 }]} showsVerticalScrollIndicator={false}>
            {configSection}
            {playerListSection}
            <View style={styles.section}>
              <Text style={styles.rulesTitle}>Forza Carte</Text>
              <View style={styles.rulesRow}>
                {[
                  { label: "JKR★", desc: "Joker Colorato" },
                  { label: "JKR", desc: "Joker B/N" },
                  { label: "2", desc: "Più forte" },
                  { label: "A", desc: "Asso" },
                  { label: "K", desc: "Re" },
                  { label: "3", desc: "Più basso" },
                ].map((r) => (
                  <View key={r.label} style={styles.ruleCard}>
                    <Text style={styles.ruleRank}>{r.label}</Text>
                    <Text style={styles.ruleDesc}>{r.desc}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>

          <View style={[styles.startContainer, { paddingBottom: bottomPad + 16 }]}>
            <LinearGradient colors={["transparent", Colors.bg, Colors.bg]} style={[StyleSheet.absoluteFill, { pointerEvents: "none" as const }]} />
            {startButton}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  landscapeBody: { flex: 1, flexDirection: "row" },
  landscapeLeftCol: {
    width: "42%",
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  landscapeLeftScroll: { padding: 16, gap: 20 },
  landscapeRightCol: { flex: 1, flexDirection: "column" },
  landscapeRightScroll: { padding: 16, gap: 16 },
  landscapeStartWrap: {
    padding: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },

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
  section: { gap: 12 },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  countRow: {
    flexDirection: "row",
    gap: 10,
  },
  countBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  countBtnActive: {
    borderColor: Colors.gold,
    backgroundColor: Colors.goldMuted,
  },
  countBtnText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 22,
    color: Colors.textSecondary,
  },
  countBtnTextActive: {
    color: Colors.gold,
  },
  roundSubLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 9,
    color: Colors.textMuted,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  modeRow: {
    flexDirection: "row",
    gap: 10,
  },
  modeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modeBtnActive: {
    borderColor: Colors.gold,
    backgroundColor: Colors.goldMuted,
  },
  modeBtnText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 14,
    color: Colors.textSecondary,
  },
  modeBtnTextActive: {
    color: Colors.gold,
  },
  playerList: {
    gap: 8,
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgSurface,
    borderRadius: 12,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  playerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
  },
  avatarGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 16,
    color: Colors.text,
  },
  nameInput: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 16,
    color: Colors.text,
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 2,
  },
  teamBadge: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  difficultyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.bgElevated,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  difficultyText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.gold,
  },
  rulesTitle: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 15,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  rulesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  ruleCard: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
    minWidth: 70,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ruleRank: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 16,
    color: Colors.gold,
  },
  ruleDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: 2,
  },
  startContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingTop: 40,
  },
  startBtn: {
    borderRadius: 14,
    overflow: "hidden",
  },
  startGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 18,
  },
  startText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 18,
    color: "#0A1F18",
    letterSpacing: 1,
  },
});
