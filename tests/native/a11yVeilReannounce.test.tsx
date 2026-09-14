// tests/native/a11yVeilReannounce.test.tsx — a live region withdrawn behind a
// veil takes its new text outside the accessibility tree, and one re-exposed
// already holding that text announces nothing. What is pinned here is the shape
// the un-veiling has to arrive in: the frame the node comes back on is empty,
// and the sentence follows it.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { A11yStatus, A11yVeil, a11yVeiled } from '@/lib/a11y';

type Rendered = { props?: Record<string, unknown>; children?: unknown[] | null };

const nodes = (tree: unknown, out: Rendered[] = []): Rendered[] => {
  if (Array.isArray(tree)) tree.forEach((n) => nodes(n, out));
  else if (tree && typeof tree === 'object') {
    const node = tree as Rendered;
    out.push(node);
    nodes(node.children ?? [], out);
  }
  return out;
};

// Read off the rendered tree rather than through `*ByLabelText`, which matches
// no node whose label is empty — and the empty frame is the subject here.
const spoken = () => {
  const regions = nodes(screen.toJSON()).filter(
    (n) => n.props?.accessibilityLiveRegion === 'polite' || n.props?.['aria-live'] === 'polite'
  );
  expect(regions).toHaveLength(1);
  return String(regions[0].props?.accessibilityLabel ?? '');
};

const nextTask = async () => {
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
};

const Harness = ({ veiled, label }: { veiled: boolean; label: string }) => (
  <A11yVeil veil={a11yVeiled(veiled)}>
    <A11yStatus label={label} />
  </A11yVeil>
);

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('a live region under a lifting veil', () => {
  it('re-enters empty and takes its text after it', async () => {
    const view = await render(<Harness veiled label="" />);

    await view.rerender(<Harness veiled label="30 secondi" />);
    expect(spoken()).toBe('');

    await view.rerender(<Harness veiled={false} label="30 secondi" />);
    expect(spoken()).toBe('');

    await nextTask();
    expect(spoken()).toBe('30 secondi');

    await view.unmount();
  });

  it('answers to its own prop with no veil above it', async () => {
    const view = await render(<A11yStatus label="" veiled />);

    await view.rerender(<A11yStatus label="mancano 10 secondi" veiled />);
    expect(spoken()).toBe('');

    await view.rerender(<A11yStatus label="mancano 10 secondi" veiled={false} />);
    expect(spoken()).toBe('');

    await nextTask();
    expect(spoken()).toBe('mancano 10 secondi');

    await view.unmount();
  });

  it('changes its text in one commit when it was never veiled', async () => {
    const view = await render(<Harness veiled={false} label="il tuo turno" />);
    expect(spoken()).toBe('il tuo turno');

    await view.rerender(<Harness veiled={false} label="30 secondi" />);
    expect(spoken()).toBe('30 secondi');

    await view.unmount();
  });
});
