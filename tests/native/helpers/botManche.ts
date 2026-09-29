import type { ReactElement } from 'react';
import { act, render } from '@testing-library/react-native';
import { initializeGame, type GameState } from '@/lib/game/gameEngine';
import { offlineBotMove, resolveStuckExchange } from '@/lib/game/autoMove';
import { settle } from './feedback';

export const STEP_MS = 1500;

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

/** Plays a whole bot manche onto one mounted table, every state holding it for STEP_MS; the caller unmounts. */
export async function playBotManche(table: (s: GameState) => ReactElement) {
  const [dealt, ...moves] = botManche();
  const r = await render(table(dealt));
  // The dealt table holds too: a bot moves only after its delay, and a first landing inside the deal's pile-up window masks the deal's cue.
  await settle(STEP_MS);
  for (const s of moves) {
    await act(async () => r.rerender(table(s)));
    await settle(STEP_MS);
  }
  return r;
}
