// tests/native/startCardHook.test.tsx — the one card that must open carries a
// stable id.
//
// `.maestro/offline-game.yaml` used to reach it by counting: `tapOn` with the
// card-name regex and `index: 0`. Maestro's `index` sorts matches by position
// rather than by tree order, and the fan's arc puts the leftmost card a pixel
// below its thirteen neighbours — enough to sort it last, so the tap took the
// second card on every run and the opening play never once succeeded on a
// device. The name cannot be reconstructed harness-side either: the banner
// spells the card `getCardDisplayRank` + `getSuitSymbol` ("3♣") where its own
// label spells it `cardSpokenName` ("3 di Fiori"). An id is the only handle
// that is neither counted nor translated.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { screen, render } from '@testing-library/react-native';
import { StraightHand } from '@/components/table/hand';
import type { Card } from '@/lib/gameEngine';

const HAND: Card[] = [
  { id: 'c-3c', rank: '3', suit: 'clubs' },
  { id: 'c-4d', rank: '4', suit: 'diamonds' },
  { id: 'c-9s', rank: '9', suit: 'spades' },
] as Card[];

function renderHand(startCardId?: string) {
  return render(
    <StraightHand
      cards={HAND}
      selectedIds={[]}
      onPress={() => {}}
      disabled={false}
      availW={600}
      roomW={600}
      startCardId={startCardId}
    />
  );
}

describe('the card the opening play must include', () => {
  it('is the only one carrying the id, whichever slot it sits in', async () => {
    const r = await renderHand('c-9s');

    expect(screen.getAllByTestId('card-start')).toHaveLength(1);
    await r.unmount();
  });

  it('marks no card when nothing has to open', async () => {
    // Every hand after the first play, and every hand that is not this seat's
    // to open. A flow that found the id here would be told to play a card the
    // rules do not single out.
    const r = await renderHand(undefined);

    expect(screen.queryByTestId('card-start')).toBeNull();
    await r.unmount();
  });

  it('marks nothing when the named card is not in this hand', async () => {
    // The opponent holds it. Marking a card anyway would hand the flow a
    // confident wrong answer, which is the failure this whole hook replaces.
    const r = await renderHand('c-not-here');

    expect(screen.queryByTestId('card-start')).toBeNull();
    await r.unmount();
  });
});
