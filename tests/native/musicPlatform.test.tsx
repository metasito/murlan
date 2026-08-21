// tests/native/musicPlatform.test.tsx — music is Android-only on native.
//
// expo-audio plays through AVFoundation, and AVPlayer cannot demux WebM: Opus
// reaches it only in MP4, and only from iOS 17. Android has decoded Opus in
// WebM since 5.0. The format is not up for negotiation — Safari 17 decodes WebM
// Opus and Ogg Opus only from 18.4, which is why #121 chose it — so iOS native
// is a deliberate no-op rather than a silent failure inside AVPlayer.
//
// This suite runs once per platform, which is the only way to see the branch:
// react-native-web takes the other side of it entirely.
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
}));

import { playMusic, stopMusic, unloadMusic } from '@/lib/music';

const createAudioPlayer = (require('expo-audio') as { createAudioPlayer: jest.Mock })
  .createAudioPlayer;

beforeEach(() => {
  unloadMusic();
  createAudioPlayer.mockClear();
});

// The fades are real timers; without this the worker outlives the run.
afterAll(() => {
  unloadMusic();
});

describe(`music on ${Platform.OS}`, () => {
  if (Platform.OS === 'ios') {
    it('never asks AVFoundation for a container it cannot demux', async () => {
      await playMusic('menu');
      expect(createAudioPlayer).not.toHaveBeenCalled();
    });

    it('stays silent without throwing, so the caller needs no platform branch', async () => {
      await expect(playMusic('hand')).resolves.toBeUndefined();
      expect(() => stopMusic()).not.toThrow();
    });
  } else {
    it('loads the track, because Android decodes Opus in WebM', async () => {
      await playMusic('menu');
      expect(createAudioPlayer).toHaveBeenCalledTimes(1);
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
  }
});
