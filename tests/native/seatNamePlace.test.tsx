import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { OpponentSeat } from '@/components/table/seats';
import { NOTICE_FACES } from '@/components/table/noticeModel';
import { SEAT_LABEL_ALIGN, seatAnchor, seatLabelLeft, seatLabelW, seatNameSet } from '@/components/seatLayout';
import type { Player } from '@/lib/game/gameEngine';

const PLAYER: Player = { id: 'player_1', name: 'Besnik', hand: [], type: 'human' };
const SCALE = 1.3;
const INSET = 17;

describe("a seat's name sits where tableRects places it", () => {
  for (const place of ['top', 'left', 'right'] as const) {
    it(`on the ${place} seat: its label's box and alignment, and the name's face, are the ones the solver reads`, async () => {
      const r = await render(<OpponentSeat place={place} player={PLAYER} isActive={false} cardCount={13} scale={SCALE} nameInset={INSET} />);
      const nameNode = screen.getByTestId('seat-name');
      const label = StyleSheet.flatten(nameNode.parent!.props.style);
      const name = StyleSheet.flatten(nameNode.props.style);
      const anchor = seatAnchor(place);
      const set = seatNameSet(SCALE);
      expect(label.alignItems).toBe(SEAT_LABEL_ALIGN[anchor]);
      expect(label.left).toBe(seatLabelLeft(anchor, SCALE, INSET));
      expect(label.width).toBe(seatLabelW(anchor, SCALE));
      expect(name.fontFamily).toBe(NOTICE_FACES[set.face].fontFamily);
      expect(name.fontSize).toBe(set.size);
      expect(name.letterSpacing).toBe(set.tracking);
      expect(name.textTransform).toBe(set.upper ? 'uppercase' : 'none');
      await r.unmount();
    });
  }
});
