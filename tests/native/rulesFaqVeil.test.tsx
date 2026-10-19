// tests/native/rulesFaqVeil.test.tsx — a collapsed FAQ answer is withdrawn
// from assistive tech, and opening it brings it back.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { en as locale } from '@/locales/en';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() } }));

import RulesScreen from '@/app/rules';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const HIDDEN = { includeHiddenElements: true };

describe('the rules FAQ', () => {
  it('veils a collapsed answer and unveils it once opened', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RulesScreen />
      </SafeAreaProvider>
    );
    expect(screen.getByTestId('faq-answer-0', HIDDEN).props.accessibilityElementsHidden).toBe(true);

    await fireEvent.press(screen.getByLabelText(locale['rules.faq.q1']));
    expect(screen.getByTestId('faq-answer-0', HIDDEN).props.accessibilityElementsHidden).toBe(false);
    expect(screen.getByTestId('faq-answer-1', HIDDEN).props.accessibilityElementsHidden).toBe(true);
    await view.unmount();
  });
});
