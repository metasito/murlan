// tests/native/rotateOverlay.test.tsx — the portrait cover is the one screen a
// player meets while holding the device the wrong way, so what it announces is
// all a screen reader has. It carries a picture and two lines of text, which is
// three nodes unless the card beneath the label is hidden — and then the same
// sentence is read three times over a screen the player cannot act on.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';

import { RotateOverlay } from '@/components/table/rotateOverlay';
import { en as locale } from '@/locales/en';

const ANNOUNCEMENT = `${locale['gameTable.rotateTitle']}. ${locale['gameTable.rotateBody']}`;

describe('the portrait cover', () => {
  it('announces itself as one node', async () => {
    const view = await render(<RotateOverlay />);
    expect(
      view.queryAllByLabelText(ANNOUNCEMENT, { includeHiddenElements: false })
    ).toHaveLength(1);
  });

  it('does not repeat its own words as separate nodes', async () => {
    const view = await render(<RotateOverlay />);
    for (const line of [locale['gameTable.rotateTitle'], locale['gameTable.rotateBody']]) {
      expect(view.queryAllByText(line, { includeHiddenElements: false })).toHaveLength(0);
    }
  });

  it('still draws both lines', async () => {
    const view = await render(<RotateOverlay />);
    for (const line of [locale['gameTable.rotateTitle'], locale['gameTable.rotateBody']]) {
      expect(view.queryAllByText(line, { includeHiddenElements: true }).length).toBeGreaterThan(0);
    }
  });
});
