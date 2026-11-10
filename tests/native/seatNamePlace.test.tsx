import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { OpponentSeat } from '@/components/table/seats';
import { NOTICE_FACES, seatBadgeH } from '@/components/table/noticeModel';
import { SEAT_DISC, SEAT_LABEL_ALIGN, seatAnchor, seatBadgeSlot, seatLabelLeft, seatLabelW, seatNameRise, seatNameSet } from '@/components/seatLayout';
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
      expect(label.bottom).toBe(SEAT_DISC * SCALE + seatNameRise(place, SCALE, 0, seatLabelRise(place, SCALE)));
      expect(name.fontFamily).toBe(NOTICE_FACES[set.face].fontFamily);
      expect(name.fontSize).toBe(set.size);
      expect(name.letterSpacing).toBe(set.tracking);
      expect(name.textTransform).toBe(set.upper ? 'uppercase' : 'none');
      await r.unmount();
    });

    it(`on the ${place} seat, vacated: the name and the badge stand where the solver reads them`, async () => {
      const r = await render(<OpponentSeat place={place} player={PLAYER} isActive={false} cardCount={13} scale={SCALE} nameInset={INSET} vacated />);
      const height = seatBadgeH('vacated', SCALE);
      const rise = seatLabelRise(place, SCALE);
      const slot = seatBadgeSlot(place, SCALE, INSET, height, rise, Infinity);
      const anchor = seatAnchor(place);
      const name = placedAt(screen.getByTestId('seat-name'));
      const badge = placedAt(screen.getByTestId('seat-vacated-chip'));
      expect(name.bottom).toBe(SEAT_DISC * SCALE + seatNameRise(place, SCALE, height, rise));
      expect(name.left).toBe(seatLabelLeft(anchor, SCALE, INSET));
      expect(name.width).toBe(seatLabelW(anchor, SCALE));
      expect(name.alignItems).toBe(SEAT_LABEL_ALIGN[anchor]);
      expect(badge.bottom).toBe(SEAT_DISC * SCALE - slot.top - height);
      expect(badge.left).toBe(slot.left);
      expect(badge.width).toBe(slot.width);
      expect(badge.alignItems).toBe(slot.align);
      if (place === 'top') expect(name.bottom).toBe(SEAT_DISC * SCALE + seatNameRise(place, SCALE, 0, rise));
      else expect(name.bottom).toBeGreaterThan(SEAT_DISC * SCALE + seatNameRise(place, SCALE, 0, rise));
      await r.unmount();
    });
  }
});
