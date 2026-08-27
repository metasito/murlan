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

  // The test above pins that Metro resolves the right file per platform, but
  // that alone doesn't prove lib/music.ts hands what Metro resolved to the
  // player rather than a hardcoded table of its own — a mock can't see that
  // difference, only lib/music.ts's own source can.
  it('creates the player from the platform-resolved TRACKS import, not a copy', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'lib', 'music.ts'), 'utf8');
    expect(source).toMatch(/import\s*\{\s*TRACKS\s*\}\s*from\s*["']@\/lib\/musicTracks["']/);
    expect(source).toMatch(/createAudioPlayer\(\s*TRACKS\[track\]\(\)\s*\)/);
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
});
