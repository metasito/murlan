import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import { Platform } from 'react-native';

const mockDecoded: string[] = [];
const node = () => ({ connect() {}, start() {}, stop() {}, disconnect() {} });
const mockCtx = {
  currentTime: 0,
  destination: {},
  createGain: () => ({
    ...node(),
    gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} },
  }),
  createBufferSource: node,
  decodeAudioData: async (bytes: { url: string }) => {
    mockDecoded.push(bytes.url);
    return { duration: 100 };
  },
};

jest.mock('@/lib/sounds', () => ({
  sharedWebCtx: () => mockCtx,
  onWebAudioUnlocked: () => () => {},
  ensureAudioMode: async () => {},
  forgetAudioMode: () => {},
}));

jest.replaceProperty(Platform, 'OS', 'web');
global.fetch = (async (url: string) => ({ arrayBuffer: async () => ({ url }) })) as never;

import { playMusic, unloadMusic } from '@/lib/music';

beforeEach(() => {
  unloadMusic();
  mockDecoded.length = 0;
});

afterAll(() => {
  unloadMusic();
});

describe('web music keeps only the tracks it can still need decoded', () => {
  it('keeps the previous track, so switching back does not decode again', async () => {
    await playMusic('menu');
    await playMusic('hand');
    await playMusic('menu');
    expect(mockDecoded).toHaveLength(2);
  });

  it('drops a track two switches back', async () => {
    await playMusic('menu');
    await playMusic('hand');
    await playMusic('cue');
    await playMusic('menu');
    expect(mockDecoded).toHaveLength(4);
  });

  it('forgets every decoded track on unload', async () => {
    await playMusic('menu');
    unloadMusic();
    await playMusic('menu');
    expect(mockDecoded).toHaveLength(2);
  });
});
