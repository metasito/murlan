import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DiagRow } from '@/lib/diagnostics';
import type { BenchContext } from '@/lib/diagnostics/bench';

const mockRows: DiagRow[] = [];
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => mockRows.push(row) } }));

const AT: Record<string, [number, number]> = { Luan: [780, 180], Drita: [420, 40], Besnik: [60, 180] };

type Probe = typeof import('@/lib/diagnostics');
let probe: Probe;
let scenario: (ctx: BenchContext) => Promise<void>;

beforeAll(() => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  probe = require('@/lib/diagnostics');
  require('@/lib/diagnostics/scenarios/seatAnchors');
  scenario = (require('@/lib/diagnostics/bench') as typeof import('@/lib/diagnostics/bench'))
    .benchScenarios()
    .find(([name]) => name === 'seatAnchors')![1];
});

const GATE = pathToFileURL(path.resolve(__dirname, '../../scripts/diagnostics-verdict.mjs')).href;
const gate = (rows: DiagRow[]) => {
  const src = `import { GATES } from ${JSON.stringify(GATE)}; let s = ''; for await (const c of process.stdin) s += c; console.log(JSON.stringify(GATES.seatAnchors(JSON.parse(s))));`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', src], { input: JSON.stringify(rows), encoding: 'utf8' });
  return JSON.parse(out.stdout) as { pass: boolean; metrics: Record<string, unknown> };
};

const ringsOf = () => mockRows.filter((r) => r.k === 'ring');

async function mountRings() {
  for (const [name, [x, y]] of Object.entries(AT)) {
    const { result } = await renderHook(() => probe.useRingProbe(name));
    (result.current as { current: unknown }).current = { measureInWindow: (cb: (x: number, y: number) => void) => cb(x, y) };
  }
}

const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

const ctx = (showTable: BenchContext['showTable'] = () => advance(0)): BenchContext => ({
  params: {},
  showTable,
  sleep: (ms) => advance(ms),
  frames: () => {},
  feltSample: () => Promise.reject(new Error('seatAnchors samples no felt')),
});

describe('the seatAnchors scenario, the ring probe and the gate', () => {
  beforeEach(async () => {
    mockRows.length = 0;
    jest.useFakeTimers();
    await mountRings();
  });
  afterEach(async () => {
    await act(async () => probe.setRingProbe(false));
    jest.useRealTimers();
  });

  it('samples no ring until the scenario switches the probe on', async () => {
    await advance(2000);
    expect(ringsOf()).toEqual([]);
    await act(async () => probe.setRingProbe(true));
    await advance(1000);
    expect(ringsOf().length).toBe(12);
    await act(async () => probe.setRingProbe(false));
    mockRows.length = 0;
    await advance(1000);
    expect(ringsOf()).toEqual([]);
  });

  it('runs with the probe on and leaves it off', async () => {
    await scenario(ctx());
    expect(ringsOf().length).toBeGreaterThan(0);
    mockRows.length = 0;
    await advance(2000);
    expect(ringsOf()).toEqual([]);
  });

  it('leaves the probe off when showTable rejects', async () => {
    let shown = 0;
    const showTable = () => (++shown < 3 ? advance(0) : Promise.reject(new Error('no table')));
    await expect(scenario(ctx(showTable))).rejects.toThrow('no table');
    expect(ringsOf().length).toBeGreaterThan(0);
    await advance(0);
    mockRows.length = 0;
    await advance(2000);
    expect(ringsOf()).toEqual([]);
  });

  it('records rows the seatAnchors gate passes', async () => {
    await scenario(ctx());
    const r = gate(mockRows);
    expect(r.metrics).toMatchObject({ rings: 3, states: 4, of: 4, unmeasured: 0, invalid: 0, badHold: 0, zeroed: 0, distinct: true });
    expect(r.pass).toBe(true);
  });
});
