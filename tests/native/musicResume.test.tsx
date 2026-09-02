// tests/native/musicResume.test.tsx — #449: the actual silence, not the route
// effect musicRouteReentry.test.tsx already rules out. iOS deactivates the
// AVAudioSession and can park the player mid-loop while the app is
// backgrounded (`shouldPlayInBackground: false`, lib/sounds.ts) — coming back
// has to rewind the player and re-arm the session lib/sounds.ts cached before
// the OS took it away, or the resume calls play() into silence.
import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    remove: jest.fn(),
    volume: 0,
    loop: false,
  })),
  setAudioModeAsync: jest.fn(async () => {}),
}));

// Not mocked: lib/sounds.ts's own ensureAudioMode/forgetAudioMode latch is
// exactly what this suite is proving takes effect on resume.
import { playMusic, unloadMusic } from '@/lib/music';

const createAudioPlayer = (require('expo-audio') as { createAudioPlayer: jest.Mock })
  .createAudioPlayer;
const setAudioModeAsync = (require('expo-audio') as { setAudioModeAsync: jest.Mock })
  .setAudioModeAsync;
const appStateAddEventListener = (require('react-native') as {
  AppState: { addEventListener: jest.Mock };
}).AppState.addEventListener;

/**
 * Reads the handler lib/music.ts registered when it was imported, at the top
 * of this file — a module-scope variable assigned inside the mock factory
 * would be clobbered, because the import that triggers the factory runs
 * before any of this file's own top-level statements do, ES-module import
 * hoisting included.
 */
function appStateListener(): (state: string) => void {
  return appStateAddEventListener.mock.calls[0][1] as (state: string) => void;
}

/** playMusic awaits ensureAudioMode before it reaches the player. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  unloadMusic();
  createAudioPlayer.mockClear();
  setAudioModeAsync.mockClear();
});

// The fades are real timers; without this the worker outlives the run.
afterAll(() => {
  unloadMusic();
});

describe('resuming native music after the app was backgrounded', () => {
  it('registers the resume handler once, at import', () => {
    expect(appStateAddEventListener).toHaveBeenCalledTimes(1);
    expect(appStateAddEventListener.mock.calls[0][0]).toBe('change');
  });

  it('rewinds the player before replaying it on return to foreground', async () => {
    await playMusic('hand');
    const player = createAudioPlayer.mock.results[0].value as {
      seekTo: jest.Mock;
      play: jest.Mock;
    };
    player.seekTo.mockClear();
    player.play.mockClear();

    appStateListener()('background');
    appStateListener()('active');
    await flush();

    expect(player.seekTo).toHaveBeenCalledWith(0);
    expect(player.seekTo.mock.invocationCallOrder[0]).toBeLessThan(
      player.play.mock.invocationCallOrder[0]
    );
  });

  it('re-arms the audio session rather than trusting it survived the background', async () => {
    await playMusic('hand');
    setAudioModeAsync.mockClear();

    appStateListener()('background');
    appStateListener()('active');
    await flush();

    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a transition that is not a return to active', async () => {
    await playMusic('hand');
    const player = createAudioPlayer.mock.results[0].value as { play: jest.Mock };
    player.play.mockClear();
    setAudioModeAsync.mockClear();

    appStateListener()('inactive');
    await flush();

    expect(player.play).not.toHaveBeenCalled();
    expect(setAudioModeAsync).not.toHaveBeenCalled();
  });
});
