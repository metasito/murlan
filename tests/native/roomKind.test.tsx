// tests/native/roomKind.test.tsx — the room screen says which kind of room this is.
//
// Two kinds of room behave differently and looked identical. A host waiting in a
// private room for strangers who can never arrive learned that from silence,
// which is the same failure #540 fixed on the friends screen: a state that
// exists and says nothing.
import { describe, test, expect } from "@jest/globals";
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { RoomKindNote } from "@/components/RoomKindNote";
import { en } from "@/locales/en";

describe("RoomKindNote", () => {
  test("a private room says the code is the only way in", async () => {
    await render(<RoomKindNote visibility="private" />);
    expect(await screen.findByText(en["room.kindPrivateBody"])).toBeTruthy();
  });

  test("a public room says a stranger may take a free seat", async () => {
    await render(<RoomKindNote visibility="public" />);
    expect(await screen.findByText(en["room.kindPublicBody"])).toBeTruthy();
  });

  /**
   * The whole point is that the two are distinguishable. Identical copy would
   * satisfy "renders something" and none of the reason this exists.
   */
  test("the two say different things", () => {
    expect(en["room.kindPrivateBody"]).not.toEqual(en["room.kindPublicBody"]);
  });

  /**
   * A visibility the client has not been taught renders nothing rather than a
   * confident wrong claim about who can join.
   */
  test("says nothing about a kind it does not recognise", async () => {
    await render(<RoomKindNote visibility={"whatever" as "public"} />);
    expect(screen.queryByText(en["room.kindPrivateBody"])).toBeNull();
    expect(screen.queryByText(en["room.kindPublicBody"])).toBeNull();
  });
});
