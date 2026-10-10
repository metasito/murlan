import type { ReactElement } from 'react';
import { act, render } from '@testing-library/react-native';
import { initializeGame, type GameState } from '@/lib/game/gameEngine';
import { offlineBotMove, resolveStuckExchange } from '@/lib/game/autoMove';
import { OFFLINE_BOT_DELAY_MS } from '@/lib/game/offlineBotDelay';
import { settle } from './feedback';

export const STEP_MS = 1500;
const FRAME_MS = 1000 / 60;

export function botManche(): GameState[] {
  let state = initializeGame(['A', 'B', 'C', 'D'].map((name) => ({ name, type: 'ai' as const })), 'free_for_all');
  const states = [state];
  while (!state.gameOver && states.length < 300) {
    const next = offlineBotMove(state) ?? (state.exchangePhase?.active ? resolveStuckExchange(state) : null);
    if (!next) break;
    state = next;
    states.push(state);
  }
  return states;
}

/** Plays a bot manche onto one mounted table, the deal held as long as an offline bot thinks and every move STEP_MS, until `done` holds or the manche ends; the caller unmounts. */
export async function playBotManche(table: (s: GameState) => ReactElement, done: () => boolean = () => false) {
  const raf = globalThis.requestAnimationFrame;
  // Worklets' jest rAF is a 0 ms setTimeout, which fake timers fire every 1 ms: 1500 frames of every animation per step.
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), FRAME_MS) as unknown as number;
  try {
    const [dealt, ...moves] = botManche();
    const r = await render(table(dealt));
    await settle(OFFLINE_BOT_DELAY_MS);
    for (const s of moves) {
      if (done()) break;
      await act(async () => r.rerender(table(s)));
      await settle(STEP_MS);
    }
    return r;
  } finally {
    globalThis.requestAnimationFrame = raf;
  }
}
