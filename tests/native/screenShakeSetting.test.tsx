import { test, expect, afterEach, jest } from "@jest/globals";
import React from "react";
import { Text, Pressable } from "react-native";
import { render, act, fireEvent, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("expo-audio", () => ({
  createAudioPlayer: () => ({ play: () => {}, remove: () => {}, seekTo: async () => {}, volume: 1 }),
  setAudioModeAsync: async () => {},
}));

import { SettingsProvider, useSettings } from "@/context/SettingsContext";
import { setScreenShakeEnabled, useScreenShakeEnabled } from "@/lib/accessibility";

function Probe() {
  const { screenShake, setScreenShake } = useSettings();
  const live = useScreenShakeEnabled();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="toggle" onPress={() => setScreenShake(!screenShake)}>
      <Text>{`setting:${screenShake} live:${live}`}</Text>
    </Pressable>
  );
}

async function mountWithStored(raw: string | null) {
  jest.spyOn(AsyncStorage, "getItem").mockResolvedValue(raw);
  const setItem = jest.spyOn(AsyncStorage, "setItem").mockResolvedValue(undefined);
  const r = await render(<SettingsProvider><Probe /></SettingsProvider>);
  await act(async () => {});
  return { r, setItem };
}

afterEach(async () => {
  jest.restoreAllMocks();
  await act(async () => setScreenShakeEnabled(true));
});

test("screen shake defaults to on for an install that never stored it", async () => {
  const { r } = await mountWithStored(JSON.stringify({ hapticsEnabled: false }));
  expect(r.getByText("setting:true live:true")).toBeTruthy();
  await r.unmount();
});

test("a stored screenShake:false reaches the table's live flag", async () => {
  const { r } = await mountWithStored(JSON.stringify({ screenShake: false }));
  expect(r.getByText("setting:false live:false")).toBeTruthy();
  await r.unmount();
});

test("a stored value that is not a boolean is ignored, not coerced", async () => {
  const { r } = await mountWithStored(JSON.stringify({ screenShake: "false" }));
  expect(r.getByText("setting:true live:true")).toBeTruthy();
  await r.unmount();
});

test("switching it off persists and reaches the live flag", async () => {
  const { r, setItem } = await mountWithStored(null);
  await fireEvent.press(r.getByLabelText("toggle"));
  expect(r.getByText("setting:false live:false")).toBeTruthy();
  await waitFor(() => {
    const last = setItem.mock.calls.at(-1);
    expect(JSON.parse(last![1] as string).screenShake).toBe(false);
  });
  await r.unmount();
});
