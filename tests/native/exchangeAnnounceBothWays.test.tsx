// tests/native/exchangeAnnounceBothWays.test.tsx — an exchange has two legs,
// and the announcement names each player as the giver of exactly one of them.
//
// It reads its two cards from separate props, so being handed only one renders
// a half-announcement rather than failing: the table watches the loser give a
// card and never learns what came back.
import { describe, it, expect } from '@jest/globals';

import React from 'react';
import { act, render, within } from '@testing-library/react-native';
import { ExchangeLegs } from '@/components/table/ExchangeLegs';
import type { Card } from '@/lib/game/gameEngine';
import { restPoint, type LegPoints } from '@/lib/game/exchangeTimeline';

/** Geometry is readExchangeLegs' business; this file is about what the ceremony says, so any leg will do. */
const HAND = { x: 0, y: 120, rot: 0, scale: 1.2 };
const LEG: LegPoints = { from: { x: 0, y: -120, rot: 0, scale: 0.4 }, fromFace: false, rest: restPoint(HAND), to: HAND, toFace: true };

const WINNER = 'Ana';
const LOSER = 'Bea';

const TAKEN: Card = { id: 'joker_colored', suit: null, rank: 'joker_colored', isJoker: true };
const RETURNED: Card = { id: '6_clubs', suit: 'clubs', rank: '6', isJoker: false };

async function announce(props: { cardReceived?: Card; cardGiven?: Card; bothJokersException?: boolean }) {
  const view = await render(
    <ExchangeLegs
      data={{ winnerName: WINNER, loserName: LOSER, winnerIdx: 1, loserIdx: 2, bothJokersException: false, ...props }}
      legs={{ receive: LEG, give: LEG }}
      viewerSeat={0}
      scale={1}
      onLanded={() => {}}
      onDismiss={() => {}}
    />
  );
  await act(async () => {});
  return view;
}

/** The banner states both legs in one place: its own alert label. */
const spoken = (view: { getByRole: (r: string) => { props: Record<string, unknown> } }) =>
  String(view.getByRole('alert').props.accessibilityLabel ?? '');

/** How many times `name` is named as the one doing the giving. */
const givesCount = (label: string, name: string) =>
  label.split(/\.\s*/).filter((line) => line.startsWith(`${name} `)).length;

describe('the exchange announcement states both legs', () => {
  it('names the loser as giver of one card and the winner as giver of the other', async () => {
    const view = await announce({ cardReceived: TAKEN, cardGiven: RETURNED });
    const label = spoken(view);

    expect(givesCount(label, LOSER)).toBe(1);
    expect(givesCount(label, WINNER)).toBe(1);
    // Direction, not just presence: the card taken off the loser travels to
    // the winner, and the card chosen by the winner travels back.
    expect(label).toMatch(new RegExp(`${LOSER}\\b.*\\b${WINNER}\\b`));
    expect(label).toMatch(new RegExp(`${WINNER}\\b.*\\b${LOSER}\\b`));

    await view.unmount();
  });

  // The floor. Fed one leg it must say one thing, not silently pad the other —
  // an assertion that only counts lines would pass on a banner that repeated
  // the same card twice.
  it('states one leg when only one card is known', async () => {
    const view = await announce({ cardReceived: TAKEN });
    const label = spoken(view);

    expect(givesCount(label, LOSER)).toBe(1);
    expect(givesCount(label, WINNER)).toBe(0);

    await view.unmount();
  });

  it('replaces both legs with the two-joker notice', async () => {
    const view = await announce({ bothJokersException: true });

    expect(spoken(view)).toContain(LOSER);
    expect(givesCount(spoken(view), WINNER)).toBe(0);

    await view.unmount();
  });

  it('tags each card with its giver, then its receiver', async () => {
    const view = await announce({ cardReceived: TAKEN, cardGiven: RETURNED });
    const text = (id: string) => view.getByTestId(id, { includeHiddenElements: true }).props.children;
    expect(text('exchange-tag-to-winner')).toMatch(new RegExp(`${LOSER}.*${WINNER}`));
    expect(text('exchange-tag-to-loser')).toMatch(new RegExp(`${WINNER}.*${LOSER}`));
    await view.unmount();
  });

  // A live region is announced, never landed on (CLAUDE.md). The announcement
  // sits on the felt with no scrim now, so there is nothing to dismiss and no
  // control anywhere in it — which makes the alert the only node here, and it
  // must still not be one.
  it('announces without being a control', async () => {
    const view = await announce({ cardReceived: TAKEN, cardGiven: RETURNED });
    const alert = view.getByRole('alert');

    expect(alert.props.onPress).toBeUndefined();
    expect(alert.props.accessibilityState?.disabled).toBeUndefined();
    expect(within(view.getByTestId('exchange-announce')).queryAllByRole('button')).toHaveLength(0);

    await view.unmount();
  });
});
