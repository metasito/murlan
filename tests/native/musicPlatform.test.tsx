// tests/native/musicPlatform.test.tsx — music on native, Android and iOS.
//
// expo-audio plays through AVFoundation on iOS, and AVFoundation cannot demux
// WebM at all: Opus reaches it only in an MP4 container, and only from iOS 17.
// Android has decoded Opus in WebM since 5.0. lib/music.ts resolves
// lib/musicTracks.ios.ts on iOS and lib/musicTracks.ts everywhere else (#178).
//
// This suite runs once per platform, which is the only way to see Metro
// actually resolve the two differently: react-native-web takes neither side
// of it.
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

  it('stays silent without throwing when creating the player fails', async () => {
    createAudioPlayer.mockImplementationOnce(() => {
      throw new Error('no decoder for this container');
    });
    await expect(playMusic('cue')).resolves.toBeUndefined();
    expect(() => stopMusic()).not.toThrow();
  });
});
