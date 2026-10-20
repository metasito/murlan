// The vacated player's two buttons (#1731): pressable only once the panel is up, and the reclaim
// only once per attempt, since each press spends one of the server's 20-per-60s rejoins.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { LeftTable } from '@/components/table/notices/netNotes';
import { en as locale } from '@/locales/en';
import { setMotion } from './harness/env';

const RECLAIM = locale['onlineGame.leftTableReclaim'];
const LEAVE = locale['onlineGame.leftTableLeave'];

const note = async (live: boolean, reclaiming: boolean) => {
  const onReclaim = jest.fn();
  const onLeave = jest.fn();
  await render(<LeftTable scale={1} live={live} reclaiming={reclaiming} onReclaim={onReclaim} onLeave={onLeave} />);
  return { onReclaim, onLeave };
};

beforeEach(() => setMotion('on'));

describe('LeftTable', () => {
  it('takes no press before the panel is up', async () => {
    const { onReclaim, onLeave } = await note(false, false);
    expect(screen.getByLabelText(RECLAIM)).toBeDisabled();
    expect(screen.getByLabelText(LEAVE)).toBeDisabled();
    await fireEvent.press(screen.getByLabelText(RECLAIM));
    await fireEvent.press(screen.getByLabelText(LEAVE));
    expect(onReclaim).not.toHaveBeenCalled();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('offers both once live', async () => {
    const { onReclaim, onLeave } = await note(true, false);
    await fireEvent.press(screen.getByLabelText(RECLAIM));
    await fireEvent.press(screen.getByLabelText(LEAVE));
    expect(onReclaim).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('holds the reclaim while one is in flight, and still lets the player leave', async () => {
    const { onReclaim, onLeave } = await note(true, true);
    expect(screen.getByLabelText(RECLAIM)).toBeDisabled();
    await fireEvent.press(screen.getByLabelText(RECLAIM));
    expect(onReclaim).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText(LEAVE));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
