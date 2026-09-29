// tests/native/exchangeAnnounceBothWays.test.tsx — an exchange has two legs, and the ceremony names
// each player as the giver of exactly one of them, each from the moment its card rests on the pile.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

import React from 'react';
import { render, within } from '@testing-library/react-native';
import { LEG } from '@/lib/game/exchangeTimeline';
import { Motion } from '@/lib/tokens';
import { Legs, card, frames, trade } from './helpers/exchangeLegs';

const WINNER = 'Ana';
const LOSER = 'Bea';
const TAKEN = { id: 'joker_colored', suit: null, rank: 'joker_colored', isJoker: true } as const;
const RETURNED = card('6_clubs', '6');
const X = Motion.exchange;
const BOTH_LANDED = X.beat + 2 * LEG.end + 2 * X.read + 64;

/** A bystander's view, so both names are spoken as names. */
const legs = (over: Parameters<typeof trade>[0]) =>
  render(<Legs trade={trade({ winnerIdx: 2, loserIdx: 1, winnerName: WINNER, loserName: LOSER, ...over })} viewerSeat={0} />);

const spoken = (view: { getByRole: (r: string) => { props: Record<string, unknown> } }) =>
  String(view.getByRole('alert').props.accessibilityLabel ?? '');

/** How many times `name` is named as the one doing the giving. */
const givesCount = (label: string, name: string) =>
  label.split(/\.\s*/).filter((line) => line.startsWith(`${name} `)).length;

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the exchange ceremony states both legs', () => {
  it('names the loser as giver of one card and the winner as giver of the other', async () => {
    const view = await legs({ cardReceived: TAKEN, cardGiven: RETURNED });
    await frames(BOTH_LANDED);
    const label = spoken(view);

    expect(givesCount(label, LOSER)).toBe(1);
    expect(givesCount(label, WINNER)).toBe(1);
    expect(label).toMatch(new RegExp(`${LOSER}\\b.*\\b${WINNER}\\b`));
    expect(label).toMatch(new RegExp(`${WINNER}\\b.*\\b${LOSER}\\b`));
    await view.unmount();
  });

  it('says nothing of a leg before its card rests on the pile', async () => {
    const view = await legs({ cardReceived: TAKEN });
    await frames(X.beat + LEG.rest - 48);
    expect(spoken(view)).toBe('');
    await frames(64);
    expect(givesCount(spoken(view), LOSER)).toBe(1);
    await view.unmount();
  });

  it('states one leg while the winner is still choosing', async () => {
    const view = await legs({ cardReceived: TAKEN });
    await frames(BOTH_LANDED);
    const label = spoken(view);

    expect(givesCount(label, LOSER)).toBe(1);
    expect(givesCount(label, WINNER)).toBe(0);
    await view.unmount();
  });

  it('replaces both legs with the two-Joker notice', async () => {
    const view = await legs({ bothJokersException: true, cardReceived: undefined });
    await frames(X.beat + LEG.rest + 32);

    expect(spoken(view)).toContain(LOSER);
    expect(givesCount(spoken(view), WINNER)).toBe(0);
    await view.unmount();
  });

  // A live region is announced, never landed on (CLAUDE.md).
  it('announces without being a control', async () => {
    const view = await legs({ cardReceived: TAKEN, cardGiven: RETURNED });
    const alert = view.getByRole('alert');

    expect(alert.props.onPress).toBeUndefined();
    expect(alert.props.accessibilityState?.disabled).toBeUndefined();
    expect(within(view.getByTestId('exchange-announce')).queryAllByRole('button')).toHaveLength(0);
    await view.unmount();
  });
});
