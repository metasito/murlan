import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { OpponentSeat } from '@/components/table/seats';
import { NOTICE_FACES, seatBadgeH } from '@/components/table/noticeModel';
import { SEAT_DISC, SEAT_LABEL_ALIGN, seatAnchor, seatLabelLeft, seatLabelRows, seatLabelW, seatNameSet } from '@/components/seatLayout';
import { seatLabelRise } from '@/components/fanGeometry';
import type { Player } from '@/lib/game/gameEngine';

const PLAYER: Player = { id: 'player_1', name: 'Besnik', hand: [], type: 'human' };
const SCALE = 1.3;
const INSET = 17;

const placedAt = (node: ReturnType<typeof screen.getByTestId>) => {
  let at = node.parent;
  while (at && StyleSheet.flatten(at.props.style)?.bottom === undefined) at = at.parent;
  return StyleSheet.flatten(at!.props.style);
};

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
      expect(label.bottom).toBe(SEAT_DISC * SCALE + seatLabelRows(SCALE, 0, seatLabelRise(place, SCALE)).name);
      expect(name.fontFamily).toBe(NOTICE_FACES[set.face].fontFamily);
      expect(name.fontSize).toBe(set.size);
      expect(name.letterSpacing).toBe(set.tracking);
      expect(name.textTransform).toBe(set.upper ? 'uppercase' : 'none');
      await r.unmount();
    });

    it(`on the ${place} seat, vacated: the name and the badge row stand on the rows the solver reads`, async () => {
      const r = await render(<OpponentSeat place={place} player={PLAYER} isActive={false} cardCount={13} scale={SCALE} nameInset={INSET} vacated />);
      const rows = seatLabelRows(SCALE, seatBadgeH('vacated', SCALE), seatLabelRise(place, SCALE));
      const anchor = seatAnchor(place);
      const name = placedAt(screen.getByTestId('seat-name'));
      const badges = placedAt(screen.getByTestId('seat-vacated-chip'));
      expect(rows.name).toBeGreaterThan(seatLabelRows(SCALE, 0, seatLabelRise(place, SCALE)).name);
      expect(name.bottom).toBe(SEAT_DISC * SCALE + rows.name);
      expect(badges.bottom).toBe(SEAT_DISC * SCALE + rows.badges);
      for (const row of [name, badges]) {
        expect(row.left).toBe(seatLabelLeft(anchor, SCALE, INSET));
        expect(row.width).toBe(seatLabelW(anchor, SCALE));
        expect(row.alignItems).toBe(SEAT_LABEL_ALIGN[anchor]);
      }
      await r.unmount();
    });
  }
});
