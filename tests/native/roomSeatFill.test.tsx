// tests/native/roomSeatFill.test.tsx — a seat filling in the room is heard and
// seen: one clack per update that fills a seat, a sting when the last one does, and each
// row entering rather than appearing.
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { getAnimatedStyle } from "react-native-reanimated";

let mockReduceMotion = false;
jest.mock("@/lib/accessibility", () => ({
  usePrefersReducedMotion: () => mockReduceMotion,
  setMotionPreference: () => {},
  getMotionPreference: () => "system",
}));

import { RoomSeatList } from "@/components/RoomSeatList";
import { bootFeedback, sounds } from "./helpers/feedback";

const fills = () => sounds().filter((s) => s === "seat_fill").length;
const fulls = () => sounds().filter((s) => s === "room_full").length;

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
  beforeEach(async () => {
    mockReduceMotion = false;
    await bootFeedback();
  });

  it("is silent for the seats already taken when the room opens", async () => {
    const view = await render(seatList([ANA, BEN]));
    expect(fills()).toBe(0);
    expect(fulls()).toBe(0);
    await view.unmount();
  });

  it("clacks once per update that fills a seat, however many it fills, and stings once when the last one does", async () => {
    const view = await render(seatList([ANA]));

    await view.rerender(seatList([ANA, BEN]));
    expect(fills()).toBe(1);
    expect(fulls()).toBe(0);

    await view.rerender(seatList([ANA, BEN, CEM, DRI]));
    expect(fills()).toBe(2);
    expect(fulls()).toBe(1);

    await view.rerender(seatList([ANA, BEN, CEM, DRI]));
    expect(fills()).toBe(2);
    expect(fulls()).toBe(1);
    await view.unmount();
  });

  it("counts a new player in a vacated seat as a fill, and a leaver as none", async () => {
    const view = await render(seatList([ANA, BEN]));

    await view.rerender(seatList([ANA]));
    expect(fills()).toBe(0);

    await view.rerender(seatList([ANA, { ...BEN, userId: "u_eda", username: "Eda" }]));
    expect(fills()).toBe(1);
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
