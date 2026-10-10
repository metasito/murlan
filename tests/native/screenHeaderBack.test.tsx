// tests/native/screenHeaderBack.test.tsx — a screen opened from a link has no
// history under it, and its back control still has to leave.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockRouter = { canGoBack: jest.fn(() => true), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));

import { ScreenHeader } from '@/components/ScreenHeader';

describe('the header back control', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter.canGoBack.mockReturnValue(true);
  });

  it('goes back when there is somewhere to go', async () => {
    await render(<ScreenHeader title="Lobby" backLabel="Back" />);
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('goes home when the screen is the first in the stack', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    await render(<ScreenHeader title="Lobby" backLabel="Back" />);
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });
});
