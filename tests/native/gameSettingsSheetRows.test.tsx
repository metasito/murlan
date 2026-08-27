// tests/native/gameSettingsSheetRows.test.tsx — the sheet is a subset of the
// settings menu, and neither the row set nor the mute wiring is reachable from
// the Playwright spec: vibration is native-only, and a browser cannot read the
// glyph a Feather name resolves to.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import glyphMap from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json';

jest.mock('expo-audio', () => ({
  createAudioPlayer: () => ({ play: () => {}, remove: () => {}, seekTo: async () => {}, volume: 1 }),
  setAudioModeAsync: async () => {},
}));

import { GameSettingsSheet } from '@/components/table/settingsSheet';
import { SettingsProvider, useSettings } from '@/context/SettingsContext';
import { en as locale } from '@/locales/en';

const METRICS = {
  frame: { x: 0, y: 0, width: 568, height: 320 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

let settings: ReturnType<typeof useSettings>;

function Probe() {
  settings = useSettings();
  return null;
}

async function mount() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SettingsProvider>
        <Probe />
        <GameSettingsSheet
          rail={40}
          topPad={0}
          bottomPad={0}
          scale={1}
          onClose={() => {}}
          focusMode={false}
          onToggleFocusMode={() => {}}
          playOnLeft={false}
          onTogglePlayOnLeft={() => {}}
          onExit={() => {}}
        />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

// A Feather is a composite, so the tree carries no `name` to read back. What it
// does carry is the codepoint, in the private use area no other text reaches —
// and the codepoint is the thing that has to be in the built subset (#415).
const charsFor = (names: (keyof typeof glyphMap)[]) =>
  names.map((n) => String.fromCodePoint(glyphMap[n]));

function glyphsOf(view: Awaited<ReturnType<typeof mount>>): string[] {
  const out: string[] = [];
  view.root?.queryAll((node) => {
    for (const child of node.children) {
      if (typeof child === 'string' && [...child].length === 1 && child.codePointAt(0)! >= 0xe000) {
        out.push(child);
      }
    }
    return false;
  });
  return out;
}

const ROWS = [
  locale['settings.sounds'],
  locale['settings.music'],
  locale['settings.haptics'],
  locale['gameSettingsSheet.focusMode'],
  locale['gameSettingsSheet.playOnLeft'],
];

describe('in-game settings sheet rows', () => {
  it('carries the settings menu rows, in the menu order', async () => {
    const view = await mount();
    const ids = screen
      .getAllByTestId(/^settings-row-/, { exact: false })
      .map((r) => String(r.props.testID).replace('settings-row-', ''));
    expect(ids).toEqual(ROWS);
    await view.unmount();
  });

  // The glyph is the only part of the row that says "muted" without words.
  it('flips the sound glyph when the row mutes', async () => {
    const view = await mount();
    expect(glyphsOf(view)).toEqual(
      charsFor(['volume-2', 'music', 'smartphone', 'eye', 'corner-down-left'])
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId(`settings-row-${locale['settings.sounds']}`));
    });
    expect(glyphsOf(view)[0]).toBe(charsFor(['volume-x'])[0]);
    await view.unmount();
  });

  // A row here and a slider in the menu drive one value, so muting at the table
  // has to come back to the level the player chose, not to the default.
  it('mutes to zero and restores the level the menu was left at', async () => {
    const view = await mount();
    await act(async () => settings.setSoundVolume(0.4));

    const row = screen.getByTestId(`settings-row-${locale['settings.sounds']}`);
    await act(async () => fireEvent.press(row));
    expect(settings.soundVolume).toBe(0);

    await act(async () => fireEvent.press(row));
    expect(settings.soundVolume).toBe(0.4);
    await view.unmount();
  });

  it('exposes one accessible node per row', async () => {
    const view = await mount();
    for (const label of ROWS) {
      expect(screen.queryAllByText(label)).toEqual([]);
    }
    expect(screen.getAllByRole('switch')).toHaveLength(ROWS.length);
    await view.unmount();
  });
});
