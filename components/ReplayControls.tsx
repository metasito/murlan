// The controls that turn a replay from something you watch into something you
// can read: a scrub bar, a move list, and a jump to the moments worth reaching.
//
// None of them hold a position of their own. The screen owns one number and
// derives the table from it (`replayStateAt`); everything here reports a new
// number and renders the one it is given, so there is no second copy of
// "where we are" to drift.

import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  type AccessibilityProps,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { getCardDisplayRank } from "@/lib/gameEngine";
import type { CombinationType } from "@/lib/gameEngine";
import type { ReplayDto, ReplayMoment } from "@/lib/replay";
import { Colors, FontSize, Radius, Spacing, TOUCH_TARGET_MIN, Type } from "@/lib/theme";
import { a11yHidden } from "@/lib/a11y";
import type { TFn, TranslationKey } from "@/lib/i18n";


/** The rules screen already names every combination, in all three locales. */
const COMBO_NAME_KEYS: Record<CombinationType, TranslationKey> = {
  single: "rules.comboSingleName",
  pair: "rules.comboPairName",
  triple: "rules.comboTripleName",
  straight: "rules.comboStraightName",
  bomb: "rules.comboBombName",
  royal_straight: "rules.comboRoyalName",
};

const SCRUB_TRACK_H = 4;
const SCRUB_THUMB = 14;
const MARKER_W = 2;
const MOVE_PANEL_W = 260;
const MOVE_NUM_W = 28;

/** Autoplay rates, cycled by one button rather than spent on a picker. */
export const REPLAY_SPEEDS = [1, 2, 0.5] as const;

/** What a move reads as: "Bomb - 7 7 7 7", or "passed". */
export function moveActionText(replay: ReplayDto, index: number, t: TFn): string {
  const combo = replay.moves[index]?.combo;
  if (!combo) return t("replay.movePassed");
  const ranks = combo.cards.map((card) => getCardDisplayRank(card.rank)).join(" ");
  return t("replay.movePlayed", { combo: t(COMBO_NAME_KEYS[combo.type]), cards: ranks });
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ScrubBar({
  index,
  total,
  moments,
  onScrub,
  t,
}: {
  index: number;
  total: number;
  moments: ReplayMoment[];
  onScrub: (index: number) => void;
  t: TFn;
}) {
  const [width, setWidth] = useState(0);

  // -1 is the opening position, so the bar spans total + 1 stops.
  const progress = total > 0 ? clampRatio((index + 1) / total) : 0;

  const scrubTo = (event: GestureResponderEvent) => {
    if (width <= 0 || total <= 0) return;
    onScrub(Math.round(clampRatio(event.nativeEvent.locationX / width) * total) - 1);
  };

  return (
    <View
      style={styles.scrubHit}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={scrubTo}
      onResponderMove={scrubTo}
      // Adjustable rather than a bare view: a scrubber that answers only to a
      // drag is unusable for anyone who cannot perform one.
      accessibilityRole="adjustable"
      accessibilityLabel={t("replay.scrubA11yLabel")}
      accessibilityValue={{ min: 0, max: Math.max(total, 0), now: index + 1 }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") onScrub(index + 1);
        if (event.nativeEvent.actionName === "decrement") onScrub(index - 1);
      }}
    >
      <View style={styles.scrubTrack}>
        <View style={[styles.scrubFill, { width: `${progress * 100}%` }]} />
        {moments.map((moment) => (
          <View
            key={`${moment.kind}-${moment.index}`}
            style={[
              styles.marker,
              moment.kind === "end" ? styles.markerEnd : styles.markerBomb,
              { left: `${total > 0 ? clampRatio((moment.index + 1) / total) * 100 : 0}%` },
            ]}
            {...a11yHidden()}
          />
        ))}
      </View>
      <View style={[styles.thumb, { left: `${progress * 100}%` }]} {...a11yHidden()} />
    </View>
  );
}

function Button({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.button}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </Pressable>
  );
}

/**
 * Split from the text button rather than taking an optional `icon`. The icon
 * font is subset to the names the app can be shown to use, and the resolver
 * that builds that subset follows a prop back to its call sites; an optional
 * icon has a call site passing none, which it cannot resolve. An unresolved
 * name is a glyph missing from the shipped font — a blank box on the web, with
 * no error anywhere.
 */
function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Button label={label} onPress={onPress}>
      {/* Decorative: the Pressable carries the label, and a labelled control
          must expose exactly one accessible node. */}
      <Ionicons name={icon} size={FontSize.lg} color={Colors.gold} {...a11yHidden()} />
    </Button>
  );
}

function TextButton({ text, label, onPress }: { text: string; label: string; onPress: () => void }) {
  return (
    <Button label={label} onPress={onPress}>
      <Text style={styles.buttonText} {...a11yHidden()}>
        {text}
      </Text>
    </Button>
  );
}

export function ReplayTransport({
  index,
  total,
  moments,
  playing,
  speed,
  movesOpen,
  onScrub,
  onStep,
  onRestart,
  onTogglePlay,
  onCycleSpeed,
  onJump,
  onToggleMoves,
  onExit,
  t,
}: {
  index: number;
  total: number;
  moments: ReplayMoment[];
  playing: boolean;
  speed: number;
  movesOpen: boolean;
  onScrub: (index: number) => void;
  onStep: (delta: number) => void;
  onRestart: () => void;
  onTogglePlay: () => void;
  onCycleSpeed: () => void;
  onJump: () => void;
  onToggleMoves: () => void;
  onExit: () => void;
  t: TFn;
}) {
  return (
    <View style={styles.transport}>
      <View style={styles.row}>
        <IconButton icon="close" label={t("replay.back")} onPress={onExit} />
        <IconButton icon="play-skip-back" label={t("replay.restartA11yLabel")} onPress={onRestart} />
        <IconButton icon="chevron-back" label={t("replay.prevA11yLabel")} onPress={() => onStep(-1)} />
        <IconButton
          icon={playing ? "pause" : "play"}
          label={playing ? t("replay.pauseA11yLabel") : t("replay.playA11yLabel")}
          onPress={onTogglePlay}
        />
        <IconButton icon="chevron-forward" label={t("replay.nextA11yLabel")} onPress={() => onStep(1)} />
        <TextButton
          label={t("replay.speedA11yLabel")}
          text={t("replay.speedValue", { n: speed })}
          onPress={onCycleSpeed}
        />
        {moments.length > 0 && (
          <IconButton icon="flash" label={t("replay.jumpA11yLabel")} onPress={onJump} />
        )}
        <IconButton
          icon={movesOpen ? "list-circle" : "list"}
          label={movesOpen ? t("replay.moveListCloseA11yLabel") : t("replay.movesToggleA11yLabel")}
          onPress={onToggleMoves}
        />
        <Text style={styles.counter}>
          {index < 0 ? t("replay.start") : t("replay.moveOf", { n: index + 1, total })}
        </Text>
      </View>
      <ScrubBar index={index} total={total} moments={moments} onScrub={onScrub} t={t} />
    </View>
  );
}

export function ReplayMoveList({
  replay,
  index,
  onJumpTo,
  onClose,
  t,
  veiled,
}: {
  replay: ReplayDto;
  index: number;
  onJumpTo: (index: number) => void;
  onClose: () => void;
  t: TFn;
  veiled?: AccessibilityProps;
}) {
  const rows = useMemo(
    () =>
      replay.moves.map((move, i) => ({
        i,
        // The seats handed in here already carry the deleted-player fallback,
        // so a name an account deletion erased cannot reappear in this list.
        name: replay.seats[move.seat]?.name ?? "",
        action: moveActionText(replay, i, t),
      })),
    [replay, t]
  );

  return (
    <View {...veiled} style={styles.movePanel}>
      <View style={styles.movePanelHead}>
        <Text style={styles.movePanelTitle}>{t("replay.moveListTitle")}</Text>
        <IconButton icon="close" label={t("replay.moveListCloseA11yLabel")} onPress={onClose} />
      </View>
      {rows.length === 0 ? (
        <Text style={styles.moveEmpty}>{t("replay.moveListEmpty")}</Text>
      ) : (
        <ScrollView style={styles.moveScroll}>
          {rows.map((row) => (
            <Pressable
              key={row.i}
              onPress={() => onJumpTo(row.i)}
              style={[styles.moveRow, row.i === index && styles.moveRowCurrent]}
              accessibilityRole="button"
              accessibilityLabel={t("replay.moveRowA11yLabel", {
                n: row.i + 1,
                name: row.name,
                action: row.action,
              })}
            >
              <Text style={styles.moveNum} {...a11yHidden()}>
                {row.i + 1}
              </Text>
              <Text style={styles.moveName} numberOfLines={1} {...a11yHidden()}>
                {row.name}
              </Text>
              <Text style={styles.moveAction} numberOfLines={1} {...a11yHidden()}>
                {row.action}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  transport: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  button: {
    minWidth: TOUCH_TARGET_MIN,
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.sm,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.goldMuted,
  },
  buttonText: {
    ...Type.caption,
    color: Colors.gold,
  },
  counter: {
    ...Type.caption,
    marginLeft: Spacing.xs,
  },
  scrubHit: {
    height: TOUCH_TARGET_MIN,
    justifyContent: "center",
  },
  scrubTrack: {
    height: SCRUB_TRACK_H,
    borderRadius: Radius.sm,
    backgroundColor: Colors.bgSurface,
  },
  scrubFill: {
    height: SCRUB_TRACK_H,
    borderRadius: Radius.sm,
    backgroundColor: Colors.gold,
  },
  marker: {
    position: "absolute",
    width: MARKER_W,
    top: -SCRUB_TRACK_H,
    bottom: -SCRUB_TRACK_H,
  },
  markerBomb: { backgroundColor: Colors.danger },
  markerEnd: { backgroundColor: Colors.textMuted },
  thumb: {
    position: "absolute",
    width: SCRUB_THUMB,
    height: SCRUB_THUMB,
    borderRadius: Radius.full,
    backgroundColor: Colors.gold,
    marginLeft: -SCRUB_THUMB / 2,
  },
  movePanel: {
    position: "absolute",
    right: Spacing.md,
    top: Spacing.md,
    bottom: Spacing.md,
    width: MOVE_PANEL_W,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.goldMuted,
    backgroundColor: Colors.feltDark,
    padding: Spacing.sm,
  },
  movePanelHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  movePanelTitle: {
    ...Type.heading,
    fontSize: FontSize.md,
  },
  moveScroll: {
    marginTop: Spacing.xs,
  },
  moveRow: {
    minHeight: TOUCH_TARGET_MIN,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.sm,
  },
  moveRowCurrent: {
    backgroundColor: Colors.bgSurface,
  },
  moveNum: {
    ...Type.caption,
    color: Colors.textMuted,
    minWidth: MOVE_NUM_W,
  },
  moveName: {
    ...Type.caption,
    flexShrink: 1,
  },
  moveAction: {
    ...Type.caption,
    color: Colors.gold,
    flexShrink: 1,
  },
  moveEmpty: {
    ...Type.caption,
    color: Colors.textMuted,
    marginTop: Spacing.sm,
  },
});
