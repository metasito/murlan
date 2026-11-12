import { makeMutable } from "react-native-reanimated";

/** How many times each felt canvas was handed a new light to draw, read by the bench across a window at rest (rule 51). */
export const FeltDraws = { felt: makeMutable(0), end: makeMutable(0) };
