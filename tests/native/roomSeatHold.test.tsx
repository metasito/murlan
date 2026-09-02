// tests/native/roomSeatHold.test.tsx — the room says a seat is held, for whom,
// and stops saying it when the hold runs out.
//
// The server refuses the seat the moment the invite ages out, so a lobby still
// promising it to a name is the room contradicting itself — and a hold that
// only ever appears is indistinguishable from one that never lets go.
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import React from "react";
import { render, screen, act } from "@testing-library/react-native";
import { RoomSeatList } from "@/components/RoomSeatList";
import { t } from "@/lib/i18n";
import { TEAMS_PLAYER_COUNT } from "@/lib/gameEngine";

const HOLD_MS = 120_000;

const HOST = { seatIndex: 0, userId: "u_host", username: "Ana" };
const HELD_FOR_BEN = { seatIndex: 2, username: "Ben", expiresInMs: HOLD_MS };

const heldLabel = () => t("room.seatHeldFor", { username: "Ben" });

function seatList(seatHolds: { seatIndex: number; username: string; expiresInMs: number }[]) {
  return (
    <RoomSeatList
      maxSeats={TEAMS_PLAYER_COUNT}
      gameMode="teams"
      players={[HOST]}
      hostUserId={HOST.userId}
      myUserId={HOST.userId}
      seatHolds={seatHolds}
      isLandscape={false}
    />
  );
}

describe("a seat held for an invited friend", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("says which seat is waiting and who it is waiting for", async () => {
    const view = await render(seatList([HELD_FOR_BEN]));

    expect(screen.getByText(heldLabel())).toBeTruthy();
    // Four seats: the host's, the one held, and the two still open to anyone.
    expect(screen.getAllByText(t("room.waitingSeat")).length).toBe(TEAMS_PLAYER_COUNT - 2);

    await view.unmount();
  });

  it("stops promising the seat once the hold has run out", async () => {
    const view = await render(seatList([HELD_FOR_BEN]));
    expect(screen.queryByText(heldLabel())).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(HOLD_MS + 1);
    });

    expect(screen.queryByText(heldLabel())).toBeNull();
    expect(screen.getAllByText(t("room.waitingSeat")).length).toBe(TEAMS_PLAYER_COUNT - 1);

    await view.unmount();
  });

  it("keeps holding it right up to the last moment", async () => {
    const view = await render(seatList([HELD_FOR_BEN]));

    await act(async () => {
      jest.advanceTimersByTime(HOLD_MS - 1);
    });

    expect(screen.queryByText(heldLabel())).toBeTruthy();

    await view.unmount();
  });

  it("holds nothing when the server sends none", async () => {
    const view = await render(seatList([]));

    expect(screen.getAllByText(t("room.waitingSeat")).length).toBe(TEAMS_PLAYER_COUNT - 1);
    expect(screen.queryByText(heldLabel())).toBeNull();

    await view.unmount();
  });
});
