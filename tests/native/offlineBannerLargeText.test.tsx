// tests/native/offlineBannerLargeText.test.tsx — #813: white text on
// Colors.danger is 4.23:1, short of the 4.5:1 body-text floor but clear of
// the 3.0:1 large-text one (tests/contrast.test.ts). The owner's decision was
// to move the text to the large-text bar rather than change the colour —
// `Colors.danger` is documented in lib/tokens.ts as a fill usable for "text
// at the large-text bar". This reads the banner's own resolved style, not
// just that its text node exists: a size dropped back below the floor must
// fail here even though the text is still on screen.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { OfflineBanner } from '@/components/OfflineBanner';
import { Colors } from '@/lib/theme';

// WCAG 2 large text is >=18pt regular or >=14pt bold — 24px and ~18.66px in
// this codebase's units (tests/tokenRoles.test.ts documents the same pair as
// 24 and 19). The banner's text is Inter_400Regular, not bold, so the
// regular-weight floor is the one that applies.
const REGULAR_LARGE_TEXT_PX = 24;

describe("the offline banner's text clears WCAG's large-text bar", () => {
  it('is drawn at or above the regular-weight large-text floor, in white on Colors.danger', async () => {
    const r = await render(<OfflineBanner />);
    const text = screen.getByTestId('offline-banner-text', { includeHiddenElements: true });
    const style = StyleSheet.flatten(text.props.style) as { fontSize?: number; color?: string };

    expect(style.fontSize ?? 0).toBeGreaterThanOrEqual(REGULAR_LARGE_TEXT_PX);
    expect(style.color).toBe(Colors.white);

    await r.unmount();
  });
});
