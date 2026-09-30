import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DiagRow } from '@/lib/diagnostics';
import type { BenchContext } from '@/lib/diagnostics/bench';
import type { GameState } from '@/lib/game/gameEngine';
import { LAMP_FLOOR, LAMP_SIDES, LAMP_SWAY, type LampSide } from '@/lib/diagnostics/lampLegibility';

const mockRows: DiagRow[] = [];
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => mockRows.push(row) } }));

let scenario: (ctx: BenchContext) => Promise<void>;

beforeAll(() => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  require('@/lib/diagnostics/scenarios/lampVariants');
  scenario = (require('@/lib/diagnostics/bench') as typeof import('@/lib/diagnostics/bench'))
    .benchScenarios()
    .find(([name]) => name === 'lampVariants')![1];
});

const GATE = pathToFileURL(path.resolve(__dirname, '../../scripts/diagnostics-verdict.mjs')).href;
const gate = (rows: DiagRow[]) => {
  const src = `import { GATES } from ${JSON.stringify(GATE)}; let s = ''; for await (const c of process.stdin) s += c; console.log(JSON.stringify(GATES.lampVariants(JSON.parse(s))));`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', src], { input: JSON.stringify(rows), encoding: 'utf8' });
  return JSON.parse(out.stdout) as { pass: boolean; metrics: Record<string, unknown> };
};

const SIDE_OF_SEAT: LampSide[] = ['bottom', 'right', 'top', 'left'];

function litTable(lift: number): BenchContext {
  let onMove: LampSide | null = null;
  return {
    params: {},
    showTable: async (state: GameState | null) => {
      onMove = state ? SIDE_OF_SEAT[state.currentTurnIndex] : null;
    },
    sleep: (ms) => act(async () => void jest.advanceTimersByTime(ms)),
    frames: () => {},
    armFrames: async () => {},
    feltSample: async () => {
      if (!onMove) throw new Error('no table on screen');
      const lit = onMove;
      return Object.fromEntries(LAMP_SIDES.map((s) => [s, s === lit ? lift : 1])) as Record<LampSide, number>;
    },
    gallery: {},
    showNotice: () => {},
  };
}

describe('the lampVariants scenario and its gate', () => {
  beforeEach(() => {
    mockRows.length = 0;
    jest.useFakeTimers();
  });

  it('samples every seat a sway period long, reading the seat the table put on move', async () => {
    await scenario(litTable(LAMP_FLOOR));
    const rows = mockRows.filter((r) => r.k === 'lampLegibility');
    expect(rows).toHaveLength(LAMP_SIDES.length * LAMP_SWAY.samples);
    expect(rows.every((r) => r.ratio === LAMP_FLOOR)).toBe(true);
    const r = gate(mockRows);
    expect(r.metrics).toMatchObject({ evenness: 1, samples: LAMP_SWAY.samples, invalid: 0 });
    expect(r.pass).toBe(true);
  });

  it('records rows the gate fails when the lit seat falls under the floor', async () => {
    await scenario(litTable(LAMP_FLOOR * 0.9));
    expect(gate(mockRows).pass).toBe(false);
  });
});
