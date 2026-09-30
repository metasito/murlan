// tests/native/tapHelpers.tsx — reaching a hand card the ways the table offers: a screen reader's
// activate, and the row's own gestures.
import { fireEvent } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';
import type { HandSelection } from '@/components/table/useSelection';

export async function activate(node: Parameters<typeof fireEvent>[0]): Promise<void> {
  await fireEvent(node, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
}

/** A UI-thread selection that holds `ids` and ignores taps, for a hand rendered on its own. */
export function stillSelection(ids: string[] = []): HandSelection {
  return { shown: makeMutable(ids), tap: () => {} };
}

type Handler = (e: unknown) => void;
export interface Captured {
  type: string;
  config: Record<string, unknown> & Partial<Record<`on${string}`, Handler>>;
}

/** The single gestures a detector was handed, by RNGH's own handler name. */
export function gesturesOf(gesture: { type: string; gestures?: Captured[] } & Partial<Captured>): {
  tap: Captured;
  pan: Captured;
} {
  const all = (gesture.gestures ?? [gesture]) as Captured[];
  const find = (type: string) => {
    const found = all.find((g) => g.type === type);
    if (!found) throw new Error(`no ${type} on the hand row`);
    return found;
  };
  return { tap: find('TapGestureHandler'), pan: find('PanGestureHandler') };
}
