// tests/native/musicPlatform.test.tsx — music on native, Android and iOS.
//
// Why native needs its own container: assets/music/README.md, "The native encode".
// The engine resolves lib/device/musicTracks.web.ts on web and lib/device/musicTracks.ts
// on iOS and Android.
//
// This suite runs once per platform, which is the only way to see Metro
// actually resolve the two differently: react-native-web takes neither side
// of it.
import { describe, it, expect } from '@jest/globals';
import { Platform } from 'react-native';
import { CONTAINER } from '@/lib/device/musicTracks';

describe(`music on ${Platform.OS}`, () => {
  it('resolves FLAC, the container react-native-audio-api decodes on both platforms', () => {
    expect(CONTAINER).toBe('flac');
  });
});
