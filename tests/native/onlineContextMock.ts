// tests/native/onlineContextMock.ts — one stand-in for the whole online
// context module.
//
// The provider exports a context hook per slice as well as the wide
// `useOnlineGame`, and a screen reaches every one of them through the slice
// hooks in `context/onlineGameHooks.ts`. A test replacing the module has to
// answer all seven or the first slice hook a screen calls gets `undefined`;
// naming them here means a seventh slice is one edit rather than one per test.
//
// Each slice hook destructures only its own fields, so one wide value answers
// all seven.
export function onlineContextMock(value: () => unknown) {
  return {
    useOnlineGame: value,
    useConnectionSlice: value,
    useRoomSlice: value,
    useTableSlice: value,
    useTurnClockSlice: value,
    useMatchSlice: value,
    useExchangeSlice: value,
  };
}
