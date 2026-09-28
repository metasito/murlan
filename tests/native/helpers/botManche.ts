import { initializeGame, type GameState } from '@/lib/game/gameEngine';
import { offlineBotMove, resolveStuckExchange } from '@/lib/game/autoMove';

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
