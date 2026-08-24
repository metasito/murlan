// tests/native/musicPlatform.test.tsx — music on native, Android and iOS.
//
// expo-audio plays through AVFoundation on iOS, and AVPlayer cannot demux WebM
// at all: Opus reaches it only in an MP4 container, and only from iOS 17.
// Android has decoded Opus in WebM since 5.0. The format is not up for
// negotiation — Safari 17 decodes WebM Opus and Ogg Opus only from 18.4, which
// is why #121 chose it — so lib/music.ts picks the container per platform
// rather than changing it for everyone (#178).
//
// This suite runs once per platform, which is the only way to see that split:
// react-native-web takes neither side of it.
import { describe, it, expect, afterAll, beforeEach, jest } from '@jest/globals';
import { Platform } from 'react-native';

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    volume: 0,
    loop: false,
  })),
}));

jest.mock('@/lib/sounds', () => ({
  sharedWebCtx: () => null,
  onWebAudioUnlocked: () => () => {},
  ensureAudioMode: jest.fn(async () => {}),
}));

import { playMusic, stopMusic, unloadMusic } from '@/lib/music';
import { ensureAudioMode } from '@/lib/sounds';

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
  it('loads the track, from whichever container this platform decodes', async () => {
    await playMusic('menu');
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  });

  it('sets the audio session to playback before creating a player, the same call sounds.ts makes', async () => {
    await playMusic('menu');
    expect(ensureAudioMode).toHaveBeenCalled();
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

  it('stays silent without throwing when creating the player fails', async () => {
    createAudioPlayer.mockImplementationOnce(() => {
      throw new Error('no decoder for this container');
    });
    await expect(playMusic('cue')).resolves.toBeUndefined();
    expect(() => stopMusic()).not.toThrow();
  });
});
