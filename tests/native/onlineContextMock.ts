// tests/native/onlineContextMock.ts — one stand-in for the whole online
// context module.
//
// The provider exports a hook per slice and `useServerError`, and a screen
// reaches them through `context/onlineGameHooks.ts`. A test replacing the
// module has to answer all of them or the first one a screen calls gets
// `undefined`; naming them here means a seventh slice is one edit rather than
// one per test.
//
// Each slice hook destructures only its own fields, so one wide value answers
// all six; a test that stands a refusal up mocks `onlineGameHooks` instead.
// The rating fields are filled in because the real provider never
// leaves them undefined, and the screen indexes them by user id.
const RATING_DEFAULTS = { ratingDeltas: {}, ratingsAfter: {}, roundRecorded: true };

export function onlineContextMock(value: () => unknown) {
  const wide = () => ({ ...RATING_DEFAULTS, ...(value() as object) });
  return {
    useOnlineConnection: wide,
    useOnlineRoom: wide,
    useOnlineTable: wide,
    useOnlineTurnClock: wide,
    useOnlineMatch: wide,
    useOnlineExchange: wide,
    useServerError: () => null,
  };
}
