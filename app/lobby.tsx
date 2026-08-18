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
import { hapticSelection, hapticSuccess } from "@/lib/haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useGame, PlayerSetupConfig } from "@/context/GameContext";
import { useAuth } from "@/context/AuthContext";
import { GameMode, MatchLength, targetsFor, teamForSeat } from "@/lib/gameEngine";
import { BOT_PERSONALITIES, botBlurbKey, botSeatNames, getBotPersonality } from "@/lib/botPersonalities";
import { Colors, Spacing, Radius, FontSize, TOUCH_TARGET_MIN, Type, WEB_BOTTOM_PAD } from '@/lib/theme';
import { MenuLayout } from "@/components/MenuLayout";
import { MenuButton } from "@/components/MenuButton";
import { useTranslation } from "@/lib/i18n";
import { a11yState, useA11yHint } from "@/lib/a11y";

type LobbyMode = "ai" | "local";

interface PlayerRowProps {
  index: number;
  config: PlayerSetupConfig;
  onChange: (config: PlayerSetupConfig) => void;
  isHuman?: boolean;
  lobbyMode: LobbyMode;
}

function PlayerRow({ index, config, onChange, isHuman, lobbyMode }: PlayerRowProps) {
  const { t } = useTranslation();
  const aiNameHint = useA11yHint(t("lobby.aiNameA11yHint"));
  const isAI = config.type === "ai";
  const personality = getBotPersonality(config.personality);

  const cyclePersonality = () => {
    const i = BOT_PERSONALITIES.findIndex((p) => p.id === personality.id);
    const next = BOT_PERSONALITIES[(i + 1) % BOT_PERSONALITIES.length];
    onChange({ ...config, personality: next.id });
    hapticSelection();
  };

  const teamLabel = config.team ? t("lobby.team", { team: config.team }) : null;

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
            color={isHuman ? Colors.bgCard : Colors.textSecondary}
          />
        </LinearGradient>
      </View>

      <View style={styles.playerInfo}>
        {lobbyMode === "local" && !isHuman ? (
          <>
            <TextInput
              value={config.name}
              onChangeText={(newName) => onChange({ ...config, name: newName })}
              style={styles.nameInput}
              placeholderTextColor={Colors.textMuted}
              maxLength={12}
              accessibilityLabel={t("lobby.aiNameA11yLabel")}
              {...aiNameHint.props}
            />
            {aiNameHint.node}
          </>
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
        <Pressable
          onPress={cyclePersonality}
          style={styles.personalityBtn}
          accessibilityRole="button"
          accessibilityLabel={t("lobby.personalityA11yLabel", {
            name: personality.name,
            style: t(botBlurbKey(personality.id)),
          })}
          hitSlop={8}
        >
          <Text style={styles.personalityText} numberOfLines={1}>
            {t(botBlurbKey(personality.id))}
          </Text>
          <Ionicons name="chevron-down" size={12} color={Colors.gold} />
        </Pressable>
      )}
    </View>
  );
}

/** Full match first: it is the canonical Murlan game (docs/RULES.md §12). */
const FORMAT_OPTIONS: readonly MatchLength[] = ["match", "single"];

export default function LobbyScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const bottomInset = Platform.OS === "web" ? WEB_BOTTOM_PAD : insets.bottom;
  const { width: W, height: H } = useWindowDimensions();
  const isLandscape = W > H;
  const { mode } = useLocalSearchParams<{ mode: LobbyMode }>();
  const { setupGame } = useGame();
  const { user } = useAuth();
  const myName = user?.username ?? t("lobby.defaultPlayerName1");

  const isAI = mode === "ai";

  const [playerCount, setPlayerCount] = useState(2);
  const [gameMode, setGameMode] = useState<GameMode>("free_for_all");
  const [matchLength, setMatchLength] = useState<MatchLength>("match");

  const formatCopy = (length: MatchLength) =>
    length === "match"
      ? { title: t("lobby.formatMatch"), detail: t("lobby.formatMatchSub", { target: targetsFor(playerCount)[0] }) }
      : { title: t("lobby.formatSingle"), detail: t("lobby.formatSingleSub") };

  /** An AI seat is called after its personality; humans keep the name they were given. */
  const withBotNames = (configs: PlayerSetupConfig[]): PlayerSetupConfig[] => {
    const aiSeats = configs.flatMap((p, i) => (p.type === "ai" ? [i] : []));
    const names = botSeatNames(aiSeats.map((i) => getBotPersonality(configs[i].personality).id));
    const updated = [...configs];
    aiSeats.forEach((seat, n) => (updated[seat] = { ...updated[seat], name: names[n] }));
    return updated;
  };

  const buildDefaultPlayers = (count: number, gm: GameMode): PlayerSetupConfig[] =>
    withBotNames(
      Array.from({ length: count }, (_, i) => ({
        name: i === 0 ? myName : t("lobby.playerName", { n: i + 1 }),
        type: i === 0 || !isAI ? "human" : "ai",
        // Distinct opponents by default: a full table faces four different personalities.
        personality: i > 0 && isAI ? BOT_PERSONALITIES[(i - 1) % BOT_PERSONALITIES.length].id : undefined,
        team: teamForSeat(i, count, gm),
      }))
    );

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
    hapticSelection();
  };

  const handleModeChange = (gm: GameMode) => {
    setGameMode(gm);
    setPlayers((prev) =>
      prev.map((p, i) => ({
        ...p,
        team: teamForSeat(i, playerCount, gm),
      }))
    );
    hapticSelection();
  };

  const handlePlayerChange = (index: number, config: PlayerSetupConfig) => {
    setPlayers((prev) => {
      const updated = [...prev];
      updated[index] = config;
      return withBotNames(updated);
    });
  };

  const handleStart = () => {
    hapticSuccess();
    setupGame(players, gameMode, matchLength);
    router.replace("/game");
  };

  const startButton = (
    <MenuButton
      label={t("lobby.start")}
      onPress={handleStart}
      variant="primary"
      size="lg"
      icon={<Ionicons name="play" size={20} color={Colors.bg} />}
      accessibilityLabel={t("lobby.start")}
    />
  );

  const configSection = (
    <>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("lobby.playerCountLabel")}</Text>
        <View style={styles.countRow}>
          {[2, 3, 4].map((n) => (
            <Pressable
              key={n}
              onPress={() => handleCountChange(n)}
              style={[styles.countBtn, playerCount === n && styles.countBtnActive]}
              accessibilityLabel={t("lobby.playerCountOptionA11yLabel", { n })}
              {...a11yState({ role: "radio", selected: playerCount === n })}
            >
              <Text style={[styles.countBtnText, playerCount === n && styles.countBtnTextActive]}>{n}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {playerCount === 4 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t("lobby.modeLabel")}</Text>
          <View style={styles.modeRow}>
            {(["free_for_all", "teams"] as GameMode[]).map((gm) => (
              <Pressable
                key={gm}
                onPress={() => handleModeChange(gm)}
                style={[styles.modeBtn, gameMode === gm && styles.modeBtnActive]}
                accessibilityLabel={gm === "teams" ? t("lobby.modeTeams") : t("lobby.modeFreeForAll")}
                {...a11yState({ role: "radio", selected: gameMode === gm })}
              >
                <Ionicons name={gm === "teams" ? "people" : "person"} size={16} color={gameMode === gm ? Colors.gold : Colors.textSecondary} />
                <Text style={[styles.modeBtnText, gameMode === gm && styles.modeBtnTextActive]}>
                  {gm === "teams" ? t("lobby.modeTeams") : t("lobby.modeFreeForAll")}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("lobby.formatLabel")}</Text>
        <View style={styles.formatRow}>
          {FORMAT_OPTIONS.map((length) => {
            const selected = matchLength === length;
            const { title, detail } = formatCopy(length);
            return (
              <Pressable
                key={length}
                onPress={() => { setMatchLength(length); hapticSelection(); }}
                style={[styles.formatBtn, selected && styles.countBtnActive]}
                accessibilityLabel={t("lobby.formatA11yLabel", { format: title, detail })}
                {...a11yState({ role: "radio", selected })}
              >
                <Text style={[styles.formatTitle, selected && styles.countBtnTextActive]}>{title}</Text>
                <Text style={[styles.formatDetail, selected && styles.formatDetailActive]}>{detail}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );

  const playerListSection = (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{t("lobby.playersLabel")}</Text>
      <View style={styles.playerList}>
        {players.map((p, i) => (
          <PlayerRow key={i} index={i} config={p} isHuman={p.type === "human"} onChange={(c) => handlePlayerChange(i, c)} lobbyMode={mode ?? "ai"} />
        ))}
      </View>
    </View>
  );

  return (
    <MenuLayout scrollable={false} centered={false} maxWidth={isLandscape ? null : undefined} style={{ paddingBottom: 0 }}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={22} color={Colors.gold} />
        </Pressable>
        <Text style={styles.screenTitle}>{isAI ? t("lobby.titleVsAI") : t("lobby.titlePassPlay")}</Text>
        <View style={{ width: 38 }} />
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
            <View style={[styles.landscapeStartWrap, { paddingBottom: bottomInset + 8 }]}>
              {startButton}
            </View>
          </View>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + 120 }]} showsVerticalScrollIndicator={false}>
            {configSection}
            {playerListSection}
            <View style={styles.section}>
              <Text style={styles.rulesTitle}>{t("lobby.rulesTitle")}</Text>
              <View style={styles.rulesRow}>
                {[
                  { label: "JKR★", desc: t("lobby.rankJokerColored") },
                  { label: "JKR", desc: t("lobby.rankJokerBlack") },
                  { label: "2", desc: t("lobby.rankStrongest") },
                  { label: "A", desc: t("lobby.rankAce") },
                  { label: "K", desc: t("lobby.rankKing") },
                  { label: "3", desc: t("lobby.rankWeakest") },
                ].map((r) => (
                  <View key={r.label} style={styles.ruleCard}>
                    <Text style={styles.ruleRank}>{r.label}</Text>
                    <Text style={styles.ruleDesc}>{r.desc}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>

          <View style={[styles.startContainer, { paddingBottom: bottomInset + 16 }]} pointerEvents="box-none">
            <LinearGradient colors={["transparent", Colors.bg, Colors.bg]} style={StyleSheet.absoluteFill} pointerEvents="none" />
            {startButton}
          </View>
        </>
      )}
    </MenuLayout>
  );
}

const styles = StyleSheet.create({
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
    width: 44,
    height: 44,
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
  scroll: {
    paddingTop: 4,
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
    minHeight: 44,
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
  formatRow: {
    flexDirection: "row",
    gap: Spacing.sm + 2,
  },
  formatBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs / 2,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  formatTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  formatDetail: {
    ...Type.caption,
    textAlign: "center",
  },
  formatDetailActive: { color: Colors.goldLight },
  modeRow: {
    flexDirection: "row",
    gap: 10,
  },
  modeBtn: {
    flex: 1,
    minHeight: 44,
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
  personalityBtn: {
    minHeight: TOUCH_TARGET_MIN,
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
  personalityText: {
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
});
