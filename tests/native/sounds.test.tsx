import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// jest.mock factories are hoisted above the imports, so anything they close
// over has to be named mock* — that prefix is Babel's allowlist.
const mockPlayer = {
  volume: 0,
  seekTo: jest.fn(),
  setPlaybackRate: jest.fn(),
  play: jest.fn(),
  remove: jest.fn(),
};
const mockCreateAudioPlayer = jest.fn(() => mockPlayer);
const still = () => 0.5;
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
    await sounds.playCardSelect(still);
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
    await sounds.playCardPass();
    await sounds.playCardPass();
    await sounds.playCardPass();
    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockPlayer.play).toHaveBeenCalledTimes(3);
  });

  it('alternates two players for select and play, so a fast repeat does not cut the first off', async () => {
    for (let i = 0; i < 4; i++) await sounds.playCardPlay();
    for (let i = 0; i < 4; i++) await sounds.playCardSelect();
    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(4);
    expect(mockPlayer.play).toHaveBeenCalledTimes(8);
  });

  it('varies pitch and gain of a repeated effect within its bounds', async () => {
    await sounds.playCardPass(() => 0);
    expect(mockPlayer.setPlaybackRate).toHaveBeenLastCalledWith(0.96);
    expect(mockPlayer.volume).toBeCloseTo(0.75 * 0.92, 5);
    await sounds.playCardPass(() => 1);
    expect(mockPlayer.setPlaybackRate).toHaveBeenLastCalledWith(1.04);
    expect(mockPlayer.volume).toBeCloseTo(0.75 * 1.08, 5);
    expect(mockPlayer.setPlaybackRate.mock.invocationCallOrder[1]).toBeLessThan(
      mockPlayer.play.mock.invocationCallOrder[1]
    );
  });

  it('never pushes a varied effect past full volume', async () => {
    await sounds.playCardPlay(() => 1);
    expect(mockPlayer.volume).toBe(1);
  });

  it('keeps a sting at its own pitch', async () => {
    await sounds.playBomb();
    expect(mockPlayer.setPlaybackRate).toHaveBeenLastCalledWith(1);
    expect(mockPlayer.volume).toBe(1);
  });

  it('sounds a deselect lower and quieter than a select', async () => {
    await sounds.playCardDeselect();
    expect(mockPlayer.setPlaybackRate).toHaveBeenLastCalledWith(0.9);
    expect(mockPlayer.volume).toBe(0.55);
  });

  it('plays the refusal sound', async () => {
    await sounds.playReject();
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });

  it('goes silent when sounds are switched off', async () => {
    const rng = jest.fn(still);
    sounds.setSoundsMasterEnabled(false);
    await sounds.playCardPlay(rng);
    await sounds.playGameWin();
    expect(rng).not.toHaveBeenCalled();
    expect(mockCreateAudioPlayer).not.toHaveBeenCalled();
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  it('scales the per-effect volume by the master volume', async () => {
    // The per-effect levels are a mix that balances the effects against each
    // other. Turning the game down has to preserve that, not flatten it.
    sounds.setSoundsMasterVolume(0.5);
    await sounds.playCardSelect(still);
    expect(mockPlayer.volume).toBeCloseTo(0.375, 5);
  });

  it('goes silent at zero volume without creating a player', async () => {
    sounds.setSoundsMasterVolume(0);
    await sounds.playCardPlay();
    expect(mockCreateAudioPlayer).not.toHaveBeenCalled();
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  it('clamps a master volume outside 0..1 instead of distorting', async () => {
    sounds.setSoundsMasterVolume(4);
    await sounds.playCardPlay(still);
    expect(mockPlayer.volume).toBe(1);
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
    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(15);
  });
});
