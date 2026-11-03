import { getAnimatedStyle as rootExport } from 'react-native-reanimated';
import type { getAnimatedStyle as nativeExport } from 'react-native-reanimated/lib/typescript/jestUtils/index.native';

// Reanimated types its root export from the web build, where getAnimatedStyle is a no-op taking nothing;
// both jest-expo projects resolve jestUtils/index.native, whose signature this is.
export const getAnimatedStyle = rootExport as unknown as typeof nativeExport;
