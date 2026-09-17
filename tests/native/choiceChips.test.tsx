import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { ChoiceChips } from '@/components/ChoiceChips';

const CHOICES = [
  { value: 'match', label: 'MATCH', detail: 'first to 100' },
  { value: 'single', label: 'SINGLE', detail: 'one manche' },
];

describe('ChoiceChips', () => {
  it('exposes one accessible node per chip, carrying its selected state', async () => {
    const view = await render(
      <ChoiceChips choices={CHOICES} value="match" onChange={() => {}} weight="title" />
    );
    const chips = view.getAllByRole('radio');
    expect(chips).toHaveLength(2);
    expect(chips[0].props.accessibilityState.selected).toBe(true);
    expect(chips[1].props.accessibilityState.selected).toBe(false);
    // The words are the chip's own name, so they must not be reachable twice.
    expect(view.getByText('MATCH', { includeHiddenElements: true }).props.accessibilityElementsHidden).toBe(true);
    expect(view.getByText('first to 100', { includeHiddenElements: true }).props.accessibilityElementsHidden).toBe(true);
    await view.unmount();
  });

  it('reports the value pressed', async () => {
    const onChange = jest.fn();
    const view = await render(
      <ChoiceChips choices={CHOICES} value="match" onChange={onChange} />
    );
    await fireEvent.press(view.getAllByRole('radio')[1]);
    expect(onChange).toHaveBeenCalledWith('single');
    await view.unmount();
  });

  it('speaks an a11yLabel in place of a bare digit', async () => {
    const view = await render(
      <ChoiceChips
        choices={[2, 3].map((n) => ({ value: n, label: String(n), a11yLabel: `${n} players` }))}
        value={2}
        onChange={() => {}}
        weight="digit"
      />
    );
    expect(view.getAllByRole('radio')[0].props.accessibilityLabel).toBe('2 players');
    await view.unmount();
  });
});
