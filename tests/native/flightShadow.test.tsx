// tests/native/flightShadow.test.tsx — a flying card carries no shadow of its own: the lamp
// shadow is the felt's (ADR-0008).
import { describe, it, expect } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { Card } from '@/lib/game/gameEngine';
import { CardCastContext } from '@/components/table/feltReady';
import { flightOf, pileOf } from './helpers/landing';

const CARDS: Card[] = [
  { id: 'A_clubs', rank: 'A', suit: 'clubs', isJoker: false } as Card,
  { id: 'A_hearts', rank: 'A', suit: 'hearts', isJoker: false } as Card,
];

describe('a flying card', () => {
  it('draws no shadow on itself or on any view inside it', async () => {
    const flight = flightOf('k', CARDS, CARDS.map(() => ({ x: 0, y: -100, rot: 0, scale: 0.4 })));
    const r = await render(<CardCastContext.Provider value="felt">{pileOf({ plays: [flight], flights: [flight] })}</CardCastContext.Provider>);

    expect(screen.queryByTestId('flying-shadow-lifted')).toBeNull();
    const fliers = screen.getAllByTestId('flying-card', { includeHiddenElements: true });
    expect(fliers).toHaveLength(CARDS.length);
    for (const node of fliers.flatMap((f) => [f, ...f.queryAll(() => true)])) {
      const style = Object.assign({}, ...[node.props.style].flat(3).filter(Boolean));
      expect(style).not.toHaveProperty('shadowOpacity');
      expect(style).not.toHaveProperty('elevation');
      expect(style).not.toHaveProperty('boxShadow');
    }
    await r.unmount();
  });
});
