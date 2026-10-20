import type { LocalSession, LocalTable } from '@/context/GameContext';

const noop = () => {};
const TABLE: LocalTable = {
  gameState: null,
  match: { length: 'single', target: 21, scores: {}, rounds: [], over: false, winners: [], isDraw: false },
  exchangeAnnouncing: false,
  exchangeAnnounceData: null,
  playCards: () => false,
  passTurn: () => false,
  runBotTurn: noop,
  chooseExchangeCard: noop,
  acknowledgeExchange: noop,
  settleExchange: noop,
  startNextRound: noop,
  startNewMatch: noop,
};
const SESSION: LocalSession = {
  setupGame: noop,
  resetGame: noop,
  hasSavedGame: false,
  resumeGame: () => false,
  restored: false,
  bootSettled: true,
};

/**
 * The module a `jest.mock('@/context/GameContext', ...)` hands back. Each part is read per call so a
 * `mock`-prefixed const flipped between renders is seen; the defaults are stable, as the provider's
 * commands are, so an effect keyed on one is not rescheduled by a render.
 */
export function localContextMock(
  table: () => Partial<Record<keyof LocalTable, unknown>> = () => ({}),
  session: () => Partial<Record<keyof LocalSession, unknown>> = () => ({})
) {
  return {
    useGameTable: () => ({ ...TABLE, ...table() }) as LocalTable,
    useGameSession: () => ({ ...SESSION, ...session() }) as LocalSession,
  };
}
