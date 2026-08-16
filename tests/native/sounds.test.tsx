import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// jest.mock factories are hoisted above the imports, so anything they close
// over has to be named mock* — that prefix is Babel's allowlist.
const mockPlayer = {
  volume: 0,
  seekTo: jest.fn(),
  play: jest.fn(),
  remove: jest.fn(),
};
const mockCreateAudioPlayer = jest.fn(() => mockPlayer);
const mockSetAudioModeAsync = jest.fn(async () => {});

jest.mock('expo-audio', () => ({
  createAudioPlayer: mockCreateAudioPlayer,
  setAudioModeAsync: mockSetAudioModeAsync,
}));

// On web lib/sounds.ts goes through the Web Audio API and never touches
// expo-audio at all, so this whole path is invisible to the Playwright suite.
describe('lib/sounds on a device', () => {
  let sounds: typeof import('@/lib/sounds');

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockPlayer.volume = 0;
    sounds = require('@/lib/sounds');
  });

  it('plays through expo-audio', async () => {
    await sounds.playCardPlay();
    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });

  it('rewinds before playing, or a finished player emits silence', async () => {
    await sounds.playCardPlay();
    expect(mockPlayer.seekTo).toHaveBeenCalledWith(0);
    expect(mockPlayer.seekTo.mock.invocationCallOrder[0]).toBeLessThan(
      mockPlayer.play.mock.invocationCallOrder[0]
    );
  });

  it('applies the per-effect volume', async () => {
    await sounds.playCardSelect();
    expect(mockPlayer.volume).toBe(0.75);
  });

  it('sets the audio mode once, not per effect', async () => {
    await sounds.playCardPlay();
    await sounds.playCardPass();
    await sounds.playBomb();
    expect(mockSetAudioModeAsync).toHaveBeenCalledTimes(1);
  });

  it('plays in silent mode — a card game is played with the ringer off', async () => {
    await sounds.playCardPlay();
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ playsInSilentMode: true })
    );
  });

  it('caches one player per effect', async () => {
    await sounds.playCardPlay();
    await sounds.playCardPlay();
    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  });

  it('goes silent when sounds are switched off', async () => {
    sounds.setSoundsMasterEnabled(false);
    await sounds.playCardPlay();
    await sounds.playGameWin();
    expect(mockCreateAudioPlayer).not.toHaveBeenCalled();
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  it('releases players on unload', async () => {
    await sounds.playCardPlay();
    sounds.unloadSounds();
    expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
    await sounds.playCardPlay();
    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(2);
  });

  it('preloads every effect', async () => {
    await sounds.preloadSounds();
    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(12);
  });
});
