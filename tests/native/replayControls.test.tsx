// tests/native/replayControls.test.tsx — the controls that make a replay
// readable rather than only watchable.
//
// Two things here cannot be left to a drag. The scrubber has to be operable
// by someone who cannot perform one, which is what `accessibilityRole
//="adjustable"` and its increment/decrement actions are for; and the move
// list must never show a name an account deletion erased.
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ReplayTransport, ReplayMoveList } from '@/components/ReplayControls';
import { replayMoments } from '@/lib/replay';
import type { ReplayDto } from '@/lib/replay';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey, TranslationParams } from '@/shared/i18n';

const t = (key: TranslationKey, params?: TranslationParams) =>
  translate(DEFAULT_LOCALE, key, params);

const card = (rank: string, suit: string) => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });

const combo = (type: string, cards: ReturnType<typeof card>[]) => ({ type, cards, strength: 1 });

const REPLAY = {
  id: 'r1',
  finishedAt: '2026-08-20T10:00:00.000Z',
  gameMode: 'free_for_all',
  seats: [
    { seatIndex: 0, userId: 'u1', name: 'Ana' },
    // What a deleted account leaves behind, after the screen's fallback.
    { seatIndex: 1, userId: null, name: 'Deleted player' },
  ],
  rankings: [],
  moves: [
    { seat: 0, combo: combo('single', [card('3', 'spades')]), handCounts: [2, 3] },
    { seat: 1, combo: null, handCounts: [2, 3] },
    {
      seat: 0,
      combo: combo('bomb', [card('7', 'hearts'), card('7', 'clubs'), card('7', 'spades'), card('7', 'diamonds')]),
      handCounts: [1, 3],
    },
  ],
} as unknown as ReplayDto;

const NOOP = () => {};

function transport(overrides: Partial<React.ComponentProps<typeof ReplayTransport>> = {}) {
  return render(
    <ReplayTransport
      index={0}
      total={REPLAY.moves.length}
      moments={replayMoments(REPLAY)}
      playing={false}
      speed={1}
      movesOpen={false}
      onScrub={NOOP}
      onStep={NOOP}
      onRestart={NOOP}
      onTogglePlay={NOOP}
      onCycleSpeed={NOOP}
      onJump={NOOP}
      onToggleMoves={NOOP}
      onExit={NOOP}
      t={t}
      {...overrides}
    />
  );
}

describe('the replay scrubber', () => {
  it('reports its position as an adjustable value, not as a bare view', async () => {
    const view = await transport({ index: 1 });

    const scrubber = view.getByLabelText(t('replay.scrubA11yLabel'));
    expect(scrubber.props.accessibilityRole).toBe('adjustable');
    expect(scrubber.props.accessibilityValue).toEqual({ min: 0, max: 3, now: 2 });
  });

  it('moves without a drag, which is the whole point of the adjustable role', async () => {
    const onScrub = jest.fn();
    const view = await transport({ index: 1, onScrub });
    const scrubber = view.getByLabelText(t('replay.scrubA11yLabel'));

    await act(async () => {
      scrubber.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
      scrubber.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    });

    expect(onScrub).toHaveBeenNthCalledWith(1, 2);
    expect(onScrub).toHaveBeenNthCalledWith(2, 0);
  });

  it('offers the jump only when there is somewhere to jump to', async () => {
    const withMoments = await transport();
    expect(withMoments.queryByLabelText(t('replay.jumpA11yLabel'))).not.toBeNull();

    const without = await transport({ moments: [] });
    expect(without.queryByLabelText(t('replay.jumpA11yLabel'))).toBeNull();
  });
});

describe('the replay move list', () => {
  it('reads one row per move, naming the seat and what it did', async () => {
    const view = await render(
      <ReplayMoveList replay={REPLAY} index={0} onJumpTo={NOOP} onClose={NOOP} t={t} />
    );

    expect(view.getByLabelText(t('replay.moveRowA11yLabel', { n: 1, name: 'Ana', action: 'Single · 3' }))).toBeTruthy();
    expect(
      view.getByLabelText(
        t('replay.moveRowA11yLabel', { n: 2, name: 'Deleted player', action: t('replay.movePassed') })
      )
    ).toBeTruthy();
  });

  it('jumps to the move that was tapped', async () => {
    const onJumpTo = jest.fn();
    const view = await render(
      <ReplayMoveList replay={REPLAY} index={0} onJumpTo={onJumpTo} onClose={NOOP} t={t} />
    );

    await fireEvent.press(
      view.getByLabelText(
        t('replay.moveRowA11yLabel', { n: 2, name: 'Deleted player', action: t('replay.movePassed') })
      )
    );

    expect(onJumpTo).toHaveBeenCalledWith(1);
  });

  it('names the combination and its cards, reusing the rules screen wording', async () => {
    const view = await render(
      <ReplayMoveList replay={REPLAY} index={0} onJumpTo={NOOP} onClose={NOOP} t={t} />
    );

    const bombAction = t('replay.movePlayed', {
      combo: t('rules.comboBombName'),
      cards: '7 7 7 7',
    });
    expect(
      view.getByLabelText(t('replay.moveRowA11yLabel', { n: 3, name: 'Ana', action: bombAction }))
    ).toBeTruthy();
  });

  it('says so rather than rendering an empty panel when a hand has no moves', async () => {
    const view = await render(
      <ReplayMoveList
        replay={{ ...REPLAY, moves: [] } as ReplayDto}
        index={-1}
        onJumpTo={NOOP}
        onClose={NOOP}
        t={t}
      />
    );

    expect(view.getByText(t('replay.moveListEmpty'))).toBeTruthy();
  });
});

// A spectator needs a way out that owes the table nothing: the rail's own
// knob is the table's, and #347 has it clipped off the top edge.
describe('leaving a replay', () => {
  it('carries an exit of its own, not one buried in the table rail', async () => {
    const onExit = jest.fn();
    const view = await transport({ onExit });

    fireEvent.press(view.getByLabelText(t('replay.back')));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
