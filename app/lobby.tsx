import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from "react-native";
import { useIsLandscape } from "@/lib/device/orientation";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { uiFeedback } from "@/lib/device/feedback";
import { ScreenHeader } from "@/components/ScreenHeader";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { PlayerSetupConfig } from "@/context/GameContext";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { useLocalSession } from "@/context/gameHooks";
import { useAuth } from "@/context/AuthContext";
import { GameMode, MatchLength, teamForSeat } from "@/lib/game/gameEngine";
import { BOT_PERSONALITIES, botSeatNames, getBotPersonality } from "@/lib/game/botPersonalities";
import { DifficultyLadder } from "@/components/DifficultyLadder";
import { Colors, Spacing, Radius, FontSize } from '@/lib/theme';
import { MenuLayout } from "@/components/MenuLayout";
import { MenuButton } from "@/components/MenuButton";
import { MatchLengthPicker, ModePicker, SeatCountPicker } from "@/components/lobbyPickers";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden } from "@/lib/a11y";

type LobbyMode = "bot" | "local";

interface PlayerRowProps {
  config: PlayerSetupConfig;
  team: "A" | "B" | undefined;
  onChange: (config: PlayerSetupConfig) => void;
  isHuman?: boolean;
}

function PlayerRow({ config, team, onChange, isHuman }: PlayerRowProps) {
  const { t } = useTranslation();
  const isBot = config.type === "bot";

  const teamLabel = team ? t("lobby.team", { team }) : null;

  return (
    <View style={styles.playerRow}>
      <View style={styles.playerTopLine}>
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
              {...a11yHidden()}
            />
          </LinearGradient>
        </View>

        <View style={styles.playerInfo}>
          <Text style={styles.playerName}>{config.name}</Text>
          {teamLabel && (
            <Text
              style={[
                styles.teamBadge,
                { color: team === "A" ? Colors.accent : Colors.gold },
              ]}
            >
              {teamLabel}
            </Text>
          )}
        </View>
      </View>

      {isBot && (
        <DifficultyLadder
          personality={config.personality}
          onChange={(id) => onChange({ ...config, personality: id })}
          a11yName={config.name}
        />
      )}
    </View>
  );
}

const START_BAR_CLEARANCE = 120;

export default function LobbyScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  // A floor, not just the real inset: on a notchless device (most desktop
  // browsers) env(safe-area-inset-*) is genuinely 0, and content flush
  // against the browser's raw edge is not a safe area, it's a missing margin.
  const bottomInset = Math.max(insets.bottom, Spacing.roomy);
  const isLandscape = useIsLandscape();
  const { mode } = useLocalSearchParams<{ mode: LobbyMode }>();
  const { setupGame, hasSavedGame, bootSettled } = useLocalSession();
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const { user } = useAuth();
  const myName = user?.username ?? t("lobby.defaultPlayerName1");

  const isBot = mode === "bot";

  const [playerCount, setPlayerCount] = useState(2);
  const [gameMode, setGameMode] = useState<GameMode>("free_for_all");
  const [matchLength, setMatchLength] = useState<MatchLength>("match");

  /** A bot seat is called after its personality; humans keep the name they were given. */
  const withBotNames = (configs: PlayerSetupConfig[]): PlayerSetupConfig[] => {
    const botSeats = configs.flatMap((p, i) => (p.type === "bot" ? [i] : []));
    const names = botSeatNames(botSeats.map((i) => getBotPersonality(configs[i].personality).id));
    const updated = [...configs];
    botSeats.forEach((seat, n) => (updated[seat] = { ...updated[seat], name: names[n] }));
    return updated;
  };

  const buildDefaultPlayers = (count: number): PlayerSetupConfig[] =>
    withBotNames(
      Array.from({ length: count }, (_, i) => ({
        name: i === 0 ? myName : t("lobby.playerName", { n: i + 1 }),
        type: i === 0 || !isBot ? "human" : "bot",
        // Distinct opponents by default: a full table faces four different personalities.
        personality: i > 0 && isBot ? BOT_PERSONALITIES[(i - 1) % BOT_PERSONALITIES.length].id : undefined,
      }))
    );

  const [players, setPlayers] = useState<PlayerSetupConfig[]>(
    buildDefaultPlayers(2)
  );

  // Seat one is the account's, and AuthContext resolves the name after first
  // render — so the seat follows it whenever it lands or changes.
  const [seatedAs, setSeatedAs] = useState(myName);
  if (myName !== seatedAs) {
    setSeatedAs(myName);
    setPlayers((prev) => prev.map((p, i) => (i === 0 ? { ...p, name: myName } : p)));
  }

  const handleCountChange = (count: number) => {
    setPlayerCount(count);
    setPlayers(buildDefaultPlayers(count));
  };

  const handlePlayerChange = (index: number, config: PlayerSetupConfig) => {
    setPlayers((prev) => {
      const updated = [...prev];
      updated[index] = config;
      return withBotNames(updated);
    });
  };

  const startGame = () => {
    uiFeedback("success");
    setupGame(players, gameMode, matchLength);
    router.replace("/game");
  };

  const handleStart = () => {
    if (!hasSavedGame) {
      startGame();
      return;
    }
    setConfirming({
      title: t("lobby.replaceSavedTitle"),
      body: t("lobby.replaceSavedBody"),
      cancelLabel: t("common.cancel"),
      confirmLabel: t("lobby.replaceSavedConfirm"),
      destructive: true,
      onConfirm: startGame,
    });
  };

  const startButton = (
    <MenuButton
      label={t("lobby.start")}
      onPress={handleStart}
      disabled={!bootSettled}
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
        <SeatCountPicker value={playerCount} onChange={handleCountChange} mode={gameMode} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("lobby.modeLabel")}</Text>
        <ModePicker value={gameMode} onChange={setGameMode} seats={playerCount} form={isLandscape ? "short" : "full"} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("lobby.formatLabel")}</Text>
        <MatchLengthPicker value={matchLength} onChange={setMatchLength} seats={playerCount} />
      </View>
    </>
  );

  const playerListSection = (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{t("lobby.playersLabel")}</Text>
      <View style={styles.playerList}>
        {players.map((p, i) => (
          <PlayerRow
            key={i}
            config={p}
            team={teamForSeat(i, players.length, gameMode)}
            isHuman={p.type === "human"} onChange={(c) => handlePlayerChange(i, c)} />
        ))}
      </View>
    </View>
  );

  return (
    <MenuLayout scrollable={false} centered={false} maxWidth={isLandscape ? null : undefined} style={{ paddingBottom: 0 }}>
      <ScreenHeader title={isBot ? t("lobby.titleVsBot") : t("lobby.titlePassPlay")} />

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
            <View style={[styles.landscapeStartWrap, { paddingBottom: bottomInset + Spacing.sm }]}>
              {startButton}
            </View>
          </View>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + START_BAR_CLEARANCE }]} showsVerticalScrollIndicator={false}>
            {configSection}
            {playerListSection}
          </ScrollView>

          <View style={[styles.startContainer, { paddingBottom: bottomInset + Spacing.md }]} pointerEvents="box-none">
            <LinearGradient colors={[Colors.bgClear, Colors.bg, Colors.bg]} style={StyleSheet.absoluteFill} pointerEvents="none" />
            {startButton}
          </View>
        </>
      )}
      <ConfirmDialog request={confirming} onClose={() => setConfirming(null)} />
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
  landscapeLeftScroll: { padding: Spacing.md, gap: Spacing.roomy },
  landscapeRightCol: { flex: 1, flexDirection: "column" },
  landscapeRightScroll: { padding: Spacing.md, gap: Spacing.md },
  landscapeStartWrap: {
    padding: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },

  scroll: {
    paddingTop: Spacing.xs,
    gap: Spacing.lg,
  },
  section: { gap: Spacing.cosy },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  playerList: {
    gap: Spacing.sm,
  },
  playerRow: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    padding: Spacing.wide,
    gap: Spacing.snug,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  playerTopLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.cosy,
  },
  playerAvatar: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
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
    fontSize: FontSize.md,
    color: Colors.text,
  },
  teamBadge: {
    fontFamily: "Inter_500Medium",
    fontSize: FontSize.xs,
    marginTop: Spacing.xxs,
    letterSpacing: 0.5,
  },
  startContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.roomy,
    paddingTop: Spacing.xxl,
  },
});
