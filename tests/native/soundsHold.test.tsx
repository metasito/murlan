import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockRemoved = { n: 0 };
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    remove: () => {
      mockRemoved.n += 1;
    },
    volume: 0,
  })),
  setAudioModeAsync: jest.fn(async () => {}),
}));

import { holdSounds, preloadSounds, unloadSounds } from '@/lib/sounds';

const createAudioPlayer = (require('expo-audio') as { createAudioPlayer: jest.Mock })
  .createAudioPlayer;

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(async () => {
  unloadSounds();
  await settle();
  createAudioPlayer.mockClear();
  mockRemoved.n = 0;
});

describe('the sound players outlive a hand-over between two screens that hold them', () => {
  it('a hold taken as the last one is released keeps every player', async () => {
    const leaving = holdSounds();
    await preloadSounds();
    const created = createAudioPlayer.mock.calls.length;
    expect(created).toBeGreaterThan(0);

    leaving();
    const arriving = holdSounds();
    await preloadSounds();
    await settle();
    expect(createAudioPlayer.mock.calls.length).toBe(created);
    expect(mockRemoved.n).toBe(0);
    arriving();
    await settle();
  });

  it('the players go once nobody holds them', async () => {
    const release = holdSounds();
    await preloadSounds();
    const created = createAudioPlayer.mock.calls.length;

    release();
    await settle();
    expect(mockRemoved.n).toBe(created);
  });
});
