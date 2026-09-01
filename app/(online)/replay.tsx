// Replay screen — a third thin adapter over the shared <GameTable>.
//
// It holds one number, the move index, and derives the whole table from it.
// The table is given `spectating`, which is exactly right: a replay has no
// seat and no hand, so every seat draws face-down and no action button exists.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { GameTable } from "@/components/GameTable";
import { MenuLayout } from "@/components/MenuLayout";
import { MenuCard } from "@/components/MenuCard";
import { MenuButton } from "@/components/MenuButton";
import { LoadingBlock, TerminalErrorBlock } from "@/components/StateBlock";
import {
  ReplayTransport,
  ReplayMoveList,
  REPLAY_SPEEDS,
} from "@/components/ReplayControls";
import {
  replayMoveCount,
  replayStateAt,
  replayMoments,
  nextMoment,
  type ReplayDto,
} from "@/lib/replay";
import { Motion } from "@/lib/theme";
import { hapticSelection } from "@/lib/haptics";
import { useTranslation } from "@/lib/i18n";

/** A replay has no actions; the table's handlers are wired to nothing. */
const NOOP = () => {};

export default function ReplayScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [movesOpen, setMovesOpen] = useState(false);

  const { data: replay, isError, isLoading } = useQuery<ReplayDto>({
    queryKey: [`/api/replays/${id}`],
    enabled: !!id,
  });

  const total = replay ? replayMoveCount(replay) : 0;
  const atEnd = index >= total - 1;
  const speed = REPLAY_SPEEDS[speedIndex];

  useEffect(() => {
    if (!playing || atEnd) return;
    const timer = setTimeout(() => setIndex((i) => i + 1), Motion.replayStep / speed);
    return () => clearTimeout(timer);
  }, [playing, atEnd, index, speed]);

  useEffect(() => {
    if (atEnd) setPlaying(false);
  }, [atEnd]);

  const clamp = useCallback((next: number) => Math.max(-1, Math.min(next, total - 1)), [total]);

  /**
   * A drag reports continuously, so this is the one mover with no haptic —
   * one tick per frame across the bar is a buzz, not feedback.
   */
  const scrubTo = useCallback(
    (next: number) => {
      setPlaying(false);
      setIndex(clamp(next));
    },
    [clamp]
  );

  const goTo = useCallback(
    (next: number) => {
      scrubTo(next);
      hapticSelection();
    },
    [scrubTo]
  );

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setIndex((i) => clamp(i + delta));
      hapticSelection();
    },
    [clamp]
  );

  const restart = useCallback(() => goTo(-1), [goTo]);

  // A player who deleted their account is erased from the stored seat, which
  // keeps no wording of its own (server/storage.ts deleteUser). The label is
  // supplied here so it is in the reader's language rather than the language
  // the hand happened to be played in.
  const named = useMemo(
    () =>
      replay
        ? {
            ...replay,
            seats: replay.seats.map((s) => ({ ...s, name: s.name || t("replay.deletedPlayer") })),
          }
        : null,
    [replay, t]
  );

  const moments = useMemo(() => (named ? replayMoments(named) : []), [named]);

  const state = useMemo(
    () => (named ? replayStateAt(named, index) : null),
    [named, index]
  );

  // Every state carries the way out, including the ones that draw nothing:
  // this screen is opened from a table, and a spectator with no control has
  // only the rail's knob left, which is the table's rather than the replay's.
  const back = (
    <MenuButton
      label={t("replay.back")}
      onPress={() => router.back()}
      variant="secondary"
      size="sm"
      accessibilityLabel={t("replay.back")}
    />
  );

  if (isLoading) {
    return (
      <MenuLayout>
        <MenuCard title={t("replay.title")}>
          <LoadingBlock label={t("replay.loadingA11yLabel")} />
          {back}
        </MenuCard>
      </MenuLayout>
    );
  }

  // A replay that arrived unreadable is a replay that is unavailable.
  if (isError || !state || !named) {
    return (
      <MenuLayout>
        <MenuCard title={t("replay.title")}>
          <TerminalErrorBlock title={t("replay.loadErrorTitle")} body={t("replay.loadErrorBody")} />
          {back}
        </MenuCard>
      </MenuLayout>
    );
  }

  return (
    <GameTable
      gameState={state}
      viewerSeat={0}
      spectating
      selectedIds={[]}
      onSelectCard={NOOP}
      onPlay={NOOP}
      onPass={NOOP}
      onQuit={() => router.back()}
      onExchangeGive={NOOP}
      banners={
        <ReplayTransport
          index={index}
          total={total}
          moments={moments}
          playing={playing}
          speed={speed}
          movesOpen={movesOpen}
          onScrub={scrubTo}
          onStep={step}
          onRestart={restart}
          onTogglePlay={() => {
            setPlaying((p) => !p);
            hapticSelection();
          }}
          onExit={() => {
            hapticSelection();
            router.back();
          }}
          onCycleSpeed={() => {
            setSpeedIndex((i) => (i + 1) % REPLAY_SPEEDS.length);
            hapticSelection();
          }}
          onJump={() => {
            const moment = nextMoment(moments, index);
            if (moment) goTo(moment.index);
          }}
          onToggleMoves={() => {
            setMovesOpen((open) => !open);
            hapticSelection();
          }}
          t={t}
        />
      }
      overlays={(veiled) =>
        movesOpen ? (
          <ReplayMoveList
            replay={named}
            index={index}
            onJumpTo={goTo}
            onClose={() => setMovesOpen(false)}
            t={t}
            veiled={veiled}
          />
        ) : null
      }
    />
  );
}
