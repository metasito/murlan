// tests/native/connectingState.test.tsx — what the online game screen shows
// before any state has arrived.
//
// Four `room:spectate` refusals, and every rejoin failure, put the player on
// this screen with nothing to draw. It must still render: the error toast that
// explains why is further down the same tree, and a screen with no text and no
// control leaves the browser's back button as the only way out.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React, { useEffect } from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useOnlineRoom } from '@/context/onlineGameHooks';
import { renderApp } from './harness/renderApp';

import { en as locale } from '@/locales/en';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args), push: jest.fn(), back: jest.fn() },
}));

// Required, not imported: an import is hoisted above the mock functions the
// factories above close over, and expo-router's would capture an undefined one.
const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType })
  .default;

// A spectate the server has not answered: no state, and no rejoin failure to
// bounce off the screen either.
function Spectating() {
  const { spectateRoom } = useOnlineRoom();
  useEffect(() => spectateRoom('ABCD'), [spectateRoom]);
  return null;
}

const mount = () =>
  renderApp(
    <>
      <Spectating />
      <OnlineGameScreen />
    </>,
    { user: { id: 'u1', username: 'Ana' }, online: true, connected: true }
  );

const BACK_LABEL = locale['onlineGame.backToLobby'];

describe('the online table with no state yet', () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it('says what it is waiting for', async () => {
    const view = await mount();

    expect(view.getByText(locale['onlineGame.connecting'])).toBeTruthy();

    await view.unmount();
  });

  it('offers a back control a screen reader can reach', async () => {
    const view = await mount();

    const back = view.getByRole('button', { name: BACK_LABEL });
    expect(back).toBeTruthy();

    await view.unmount();
  });

  it('releases the table and returns to the lobby when it is pressed', async () => {
    const view = await mount();

    view.socket().reset();
    fireEvent.press(view.getByRole('button', { name: BACK_LABEL }));

    await waitFor(() => expect(view.socket().sentAs('room:unspectate')).toHaveLength(1));
    expect(mockReplace).toHaveBeenCalledWith('/(online)');

    await view.unmount();
  });
});
