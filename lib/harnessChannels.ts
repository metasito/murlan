/**
 * Every `dataSet` key a screen publishes for the browser suite, and the attribute
 * react-native-web renders it as. eslint.guards.cjs requires this at config time, so it
 * imports nothing.
 */
export const CHANNELS = {
  tableState: "data-table-state",
  dealing: "data-dealing",
  handState: "data-hand-state",
  seatLit: "data-seat-lit",
  lit: "data-lit",
} as const;

export type Channel = keyof typeof CHANNELS;
