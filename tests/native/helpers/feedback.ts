import { jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { SOUNDS, SOUND_FILES, type SoundId } from '@/lib/device/soundAssets';
import { TRACKS } from '@/lib/device/musicTracks';
import { audioApiState, type MockNode } from '../mocks/audioApi';

const KEYS = [...Object.keys(SOUND_FILES), ...Object.keys(TRACKS)];

export const api = audioApiState;
export const ctxTime = (jsMs: number) => jsMs / 1000 + 10;
export const ctxAt = (jsMs: number) => ctxTime(jsMs - 8 - 5 / 2);

const sources = () =>
  api().contexts.flatMap((c) => c.nodes).filter((n) => n.kind === 'source' && n.id >= api().epoch && n.startedAt !== undefined);

export const effects = () => sources().filter((n) => !n.loop);
export const loops = () => sources().filter((n) => n.loop);
export const fileOf = (n: MockNode) => (n.buffer ? KEYS[Number(n.buffer.path.slice('file:///asset-'.length))] : undefined);

export function soundOf(n: MockNode): SoundId | undefined {
  const file = fileOf(n);
  const ids = (Object.keys(SOUNDS) as SoundId[]).filter((id) => SOUNDS[id].file === file);
  return ids.find((id) => SOUNDS[id].rate === n.playbackRate.value) ?? ids.find((id) => SOUNDS[id].rate === undefined);
}

export const sounds = () => effects().map(soundOf);
export const startsOf = (id: SoundId) => effects().filter((n) => soundOf(n) === id).map((n) => n.startedAt!);
export const voiceGain = (n: MockNode) => n.outputs[0].gain.value;
export const musicBus = () => loops().at(-1)!.outputs[0].outputs[0];

export function appStateHandler(): (state: string) => void {
  const calls = jest.mocked(AppState.addEventListener).mock.calls.filter(([event]) => event === 'change');
  return calls.at(-1)![1] as (state: string) => void;
}

export const settle = (ms = 0) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
