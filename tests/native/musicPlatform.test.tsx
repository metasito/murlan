// tests/native/musicPlatform.test.tsx — music on native, Android and iOS.
//
// Why iOS needs its own container: assets/music/README.md, "The iOS encode".
// lib/music.ts resolves lib/musicTracks.ios.ts on iOS and lib/musicTracks.ts
// everywhere else (#178).
//
// This suite runs once per platform, which is the only way to see Metro
// actually resolve the two differently: react-native-web takes neither side
// of it.
import { describe, it, expect, afterAll, beforeEach, jest } from '@jest/globals';
import { Platform } from 'react-native';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    remove: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    volume: 0,
    loop: false,
  })),
}));

jest.mock('@/lib/sounds', () => ({
  sharedWebCtx: () => null,
  onWebAudioUnlocked: () => () => {},
  ensureAudioMode: jest.fn(async () => {}),
}));

import { playMusic, setMusicMasterEnabled, stopMusic, unloadMusic } from '@/lib/music';
import { ensureAudioMode } from '@/lib/sounds';
import { CONTAINER } from '@/lib/musicTracks';

const createAudioPlayer = (require('expo-audio') as { createAudioPlayer: jest.Mock })
  .createAudioPlayer;

beforeEach(() => {
  unloadMusic();
  createAudioPlayer.mockClear();
  (ensureAudioMode as jest.Mock).mockClear();
});

// The fades are real timers; without this the worker outlives the run.
afterAll(() => {
  unloadMusic();
});

describe(`music on ${Platform.OS}`, () => {
  it('resolves the container this platform can decode', () => {
    expect(CONTAINER).toBe(Platform.OS === 'ios' ? 'm4a' : 'webm');
  });

  // The test above pins that Metro resolves the right file per platform, but
  // that alone doesn't prove lib/music.ts hands what Metro resolved to the
  // player rather than a hardcoded table of its own — a mock can't see that
  // difference, only lib/music.ts's own source can.
  it('creates the player from the platform-resolved TRACKS import, not a copy', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'lib', 'music.ts'), 'utf8');
    expect(source).toMatch(/import\s*\{\s*TRACKS\s*\}\s*from\s*["']@\/lib\/musicTracks["']/);
    expect(source).toMatch(/createAudioPlayer\(\s*TRACKS\[track\]\(\)/);
  });

  it('creates one player when a track starts', async () => {
    await playMusic('menu');
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  });

  it('calls ensureAudioMode before creating a player', async () => {
    await playMusic('menu');
    expect(ensureAudioMode).toHaveBeenCalled();
    expect((ensureAudioMode as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      createAudioPlayer.mock.invocationCallOrder[0]
    );
  });

  it('does not reload a track that is already the one playing', async () => {
    await playMusic('menu');
    await playMusic('menu');
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  });

  it('loads a second player when the track changes', async () => {
    await playMusic('menu');
    await playMusic('hand');
    expect(createAudioPlayer).toHaveBeenCalledTimes(2);
  });

  // #885: playMusic's own docstring says a repeat request is a no-op, but
  // playNativeMusic used to call seekTo unconditionally — audible as the loop
  // restarting on every menu-to-menu navigation, since all four menu screens
  // request the same track.
  it('does not rewind a track that is already playing', async () => {
    await playMusic('menu');
    const player = createAudioPlayer.mock.results[0].value as {
      seekTo: jest.Mock;
      play: jest.Mock;
    };
    player.seekTo.mockClear();
    player.play.mockClear();

    await playMusic('menu');

    expect(player.seekTo).not.toHaveBeenCalled();
  });

  it('still plays when a genuine track change follows one already playing', async () => {
    await playMusic('menu');
    await playMusic('hand');
    const handPlayer = createAudioPlayer.mock.results[1].value as { seekTo: jest.Mock };
    expect(handPlayer.seekTo).toHaveBeenCalledWith(0);
  });

  // Any screen that mounts GameTable reaches playMusic, which reaches
  // ensureAudioMode — so a lib/sounds mock that omits it throws at render, in a
  // suite about something else entirely, naming a line no one there wrote. The
  // stub is one line; finding out why you need it is the expensive part.
  it('every lib/sounds mock in this directory stubs ensureAudioMode', () => {
    const offenders = readdirSync(__dirname)
      .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
      .filter((f) => {
        const source = readFileSync(join(__dirname, f), 'utf8');
        return source.includes("jest.mock('@/lib/sounds'") && !source.includes('ensureAudioMode');
      });
    expect(offenders).toEqual([]);
  });

  it('stays silent without throwing when creating the player fails', async () => {
    createAudioPlayer.mockImplementationOnce(() => {
      throw new Error('no decoder for this container');
    });
    await expect(playMusic('cue')).resolves.toBeUndefined();
    expect(() => stopMusic()).not.toThrow();
  });

  // The settings toggle is the only caller of setMusicMasterEnabled, and it
  // passes no track — so turning music off has to leave the requested one
  // behind or nothing ever comes back but a route change.
  it('restarts the requested track when music is switched off and on again', async () => {
    await playMusic('menu');
    const player = createAudioPlayer.mock.results[0].value as { play: jest.Mock };
    player.play.mockClear();

    setMusicMasterEnabled(false);
    setMusicMasterEnabled(true);
    // setMusicMasterEnabled cannot be awaited, and playMusic awaits the audio
    // mode before it reaches the player.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(player.play).toHaveBeenCalled();
  });

  // Dev-only timing instrumentation (#824) subscribes to playbackStatusUpdate
  // on every play; if the subscription is never removed it leaks across toggles.
  it('registers and removes a playbackStatusUpdate subscription on each play', async () => {
    await playMusic('menu');
    const player = createAudioPlayer.mock.results[0].value as {
      addListener: jest.Mock;
    };
    const remove = jest.fn();
    player.addListener.mockReturnValueOnce({ remove });

    setMusicMasterEnabled(false);
    setMusicMasterEnabled(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(player.addListener).toHaveBeenCalledWith('playbackStatusUpdate', expect.any(Function));
    stopMusic();
    expect(remove).toHaveBeenCalled();
  });

  // The registration test above proves the subscription lifecycle, not the
  // handler body itself — invoke it the way a real status event would.
  it('logs a status sample without throwing when a playbackStatusUpdate event fires', async () => {
    await playMusic('menu');
    const player = createAudioPlayer.mock.results[0].value as { addListener: jest.Mock };
    const onStatus = player.addListener.mock.calls[0][1] as (status: Record<string, unknown>) => void;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    expect(() =>
      onStatus({
        playing: true,
        currentTime: 0.02,
        isBuffering: false,
        timeControlStatus: 'playing',
        reasonForWaitingToPlay: '',
      })
    ).not.toThrow();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('status#1'));

    logSpy.mockRestore();
  });
});
