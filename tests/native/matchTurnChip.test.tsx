// tests/native/matchTurnChip.test.tsx — the turn chip names the match's end, not the round's (#1525).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { CASES, table } from './helpers/closeMatch';
import { bootFeedback, settle } from './helpers/feedback';

const HIDDEN = { includeHiddenElements: true };
const chipName = (spoken: string) => screen.queryAllByLabelText(spoken, HIDDEN);
const tableSays = (spoken: string) =>
  screen.queryAllByLabelText(new RegExp(`^${spoken.replace('.', '\\.')}`), HIDDEN).length +
  screen.queryAllByText(new RegExp(`^${spoken.replace('.', '\\.')}`), HIDDEN).length;

beforeEach(async () => {
  jest.useFakeTimers();
  await bootFeedback();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the turn chip at a round end', () => {
  it('reads the match label once the match is over', async () => {
    const view = await render(table(CASES[0], false));
    await settle(2000);
    await view.rerender(table(CASES[0], true));
    await settle(1500);
    expect(screen.queryAllByText('Match over', HIDDEN).length).toBeGreaterThan(0);
    expect(chipName('The match is over.').length).toBeGreaterThan(0);
    expect(tableSays('The match is over.')).toBeGreaterThan(0);
    expect(screen.queryAllByText('Hand over', HIDDEN)).toHaveLength(0);
    expect(tableSays('The hand is over.')).toBe(0);
    await view.unmount();
  });

  it('keeps the round label when the match goes on', async () => {
    const view = await render(table(CASES[0], false));
    await settle(2000);
    await view.rerender(table(CASES[0], true, false));
    await settle(1500);
    expect(screen.queryAllByText('Hand over', HIDDEN).length).toBeGreaterThan(0);
    expect(chipName('The hand is over.').length).toBeGreaterThan(0);
    expect(tableSays('The hand is over.')).toBeGreaterThan(0);
    expect(screen.queryAllByText('Match over', HIDDEN)).toHaveLength(0);
    expect(tableSays('The match is over.')).toBe(0);
    await view.unmount();
  });
});
