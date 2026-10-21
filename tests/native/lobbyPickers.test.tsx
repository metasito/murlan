// The pickers own the teams rule: what modeFits rules out is offered, disabled, in every lobby.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { ModePicker, SeatCountPicker } from '@/components/lobbyPickers';
import { TEAMS_PLAYER_COUNT, modeFits } from '@/lib/game/gameEngine';
import { en } from '@/locales/en';

const seatLabel = (n: number) => en['lobby.playerCountOptionA11yLabel'].replace('{{n}}', String(n));

describe('ModePicker', () => {
  it('disables teams for every seat count modeFits rules out, and only those', async () => {
    for (const seats of [2, 3, 4]) {
      const view = await render(<ModePicker value="free_for_all" onChange={() => {}} seats={seats} />);
      const teams = view.getAllByRole('radio')[1];
      expect(teams.props.accessibilityState.disabled).toBe(!modeFits('teams', seats));
      expect(view.getAllByRole('radio')[0].props.accessibilityState.disabled).toBe(false);
      await view.unmount();
    }
  });

  it('a disabled teams chip says how many players it needs, and does not answer a press', async () => {
    const onChange = jest.fn();
    const view = await render(<ModePicker value="free_for_all" onChange={onChange} seats={2} />);
    const teams = view.getAllByRole('radio')[1];
    expect(teams.props.accessibilityLabel).toContain(String(TEAMS_PLAYER_COUNT));
    await fireEvent.press(teams);
    expect(onChange).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('names the modes in the form asked for, whatever the density', async () => {
    const full = await render(<ModePicker value="free_for_all" onChange={() => {}} seats={4} compact />);
    expect(full.getByRole('radio', { name: en['term.mode.freeForAll'] })).toBeTruthy();
    await full.unmount();
    const short = await render(<ModePicker value="free_for_all" onChange={() => {}} seats={4} form="short" />);
    expect(short.getByRole('radio', { name: en['term.mode.freeForAllShort'] })).toBeTruthy();
    await short.unmount();
  });
});

describe('SeatCountPicker', () => {
  it('disables every seat count modeFits rules out for the mode, and only those', async () => {
    for (const mode of ['teams', 'free_for_all'] as const) {
      const view = await render(<SeatCountPicker value={4} onChange={() => {}} mode={mode} />);
      for (const n of [2, 3, 4]) {
        expect(view.getByRole('radio', { name: seatLabel(n) }).props.accessibilityState.disabled).toBe(
          !modeFits(mode, n)
        );
      }
      await view.unmount();
    }
  });
});
