// tests/native/roomSeatFill.test.tsx — a seat filling in the room is heard and
// seen: one clack per seat that fills, a sting when the last one does, and each
// row entering rather than appearing.
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { getAnimatedStyle } from "react-native-reanimated";

const mockPlaySeatFill = jest.fn(async () => {});
const mockPlayRoomFull = jest.fn(async () => {});
jest.mock("@/lib/sounds", () => ({
  playSeatFill: () => mockPlaySeatFill(),
  playRoomFull: () => mockPlayRoomFull(),
}));

let mockReduceMotion = false;
jest.mock("@/lib/accessibility", () => ({
  usePrefersReducedMotion: () => mockReduceMotion,
  setMotionPreference: () => {},
  getMotionPreference: () => "system",
}));

import { RoomSeatList } from "@/components/RoomSeatList";

const SEATS = 4;
const ANA = { seatIndex: 0, userId: "u_ana", username: "Ana" };
const BEN = { seatIndex: 1, userId: "u_ben", username: "Ben" };
const CEM = { seatIndex: 2, userId: "u_cem", username: "Cem" };
const DRI = { seatIndex: 3, userId: "u_dri", username: "Dri" };

type Seated = typeof ANA;

function seatList(players: Seated[]) {
  return (
    <RoomSeatList
      maxSeats={SEATS}
      gameMode="free_for_all"
      players={players}
      hostUserId={ANA.userId}
      myUserId={ANA.userId}
      isLandscape={false}
    />
  );
}

function translateY(testID: string): number | undefined {
  const style = getAnimatedStyle(screen.getByTestId(testID)) as {
    transform?: { translateY?: number }[];
  };
  return style.transform?.find((t) => "translateY" in t)?.translateY;
}

describe("a seat filling in the room", () => {
  beforeEach(() => {
    mockPlaySeatFill.mockClear();
    mockPlayRoomFull.mockClear();
    mockReduceMotion = false;
  });

  it("is silent for the seats already taken when the room opens", async () => {
    const view = await render(seatList([ANA, BEN]));
    expect(mockPlaySeatFill).not.toHaveBeenCalled();
    expect(mockPlayRoomFull).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("clacks once per seat that fills, and stings once when the last one does", async () => {
    const view = await render(seatList([ANA]));

    await view.rerender(seatList([ANA, BEN]));
    expect(mockPlaySeatFill).toHaveBeenCalledTimes(1);
    expect(mockPlayRoomFull).not.toHaveBeenCalled();

    await view.rerender(seatList([ANA, BEN, CEM, DRI]));
    expect(mockPlaySeatFill).toHaveBeenCalledTimes(3);
    expect(mockPlayRoomFull).toHaveBeenCalledTimes(1);

    await view.rerender(seatList([ANA, BEN, CEM, DRI]));
    expect(mockPlaySeatFill).toHaveBeenCalledTimes(3);
    expect(mockPlayRoomFull).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("counts a new player in a vacated seat as a fill, and a leaver as none", async () => {
    const view = await render(seatList([ANA, BEN]));

    await view.rerender(seatList([ANA]));
    expect(mockPlaySeatFill).not.toHaveBeenCalled();

    await view.rerender(seatList([ANA, { ...BEN, userId: "u_eda", username: "Eda" }]));
    expect(mockPlaySeatFill).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("brings a filled row in from below, and without travel under reduced motion", async () => {
    const moving = await render(seatList([ANA]));
    expect(screen.getByText("Ana", { exact: false })).toBeTruthy();
    expect(translateY("room-seat-0")).toBeGreaterThan(0);
    await moving.unmount();

    mockReduceMotion = true;
    const still = await render(seatList([ANA]));
    expect(screen.getByText("Ana", { exact: false })).toBeTruthy();
    expect(translateY("room-seat-0")).toBe(0);
    await still.unmount();
  });
});
