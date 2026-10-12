import type { ReactElement } from 'react';
import { act, render } from '@testing-library/react-native';
import { initializeGame, type GameState } from '@/lib/game/gameEngine';
import { offlineBotMove, resolveStuckExchange } from '@/lib/game/autoMove';
import { OFFLINE_BOT_DELAY_MS } from '@/lib/game/offlineBotDelay';
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

/** Plays a bot manche onto one mounted table, the deal held as long as an offline bot thinks and every move STEP_MS, until `done` holds or the manche ends; the caller unmounts. */
export async function playBotManche(table: (s: GameState) => ReactElement, done: () => boolean = () => false) {
  const [dealt, ...moves] = botManche();
  const r = await render(table(dealt));
  await settle(OFFLINE_BOT_DELAY_MS);
  for (const s of moves) {
    if (done()) break;
    await act(async () => r.rerender(table(s)));
    await settle(STEP_MS);
  }
  return r;
}
