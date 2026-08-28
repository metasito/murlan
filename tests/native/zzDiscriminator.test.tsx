// TEMPORARY — deleted before merge. Answers one question: does a synchronous
// setState inside an async handler re-render in this harness at all?
import { describe, it, expect } from '@jest/globals';
import React, { useState } from 'react';
import { Text, Pressable } from 'react-native';
import { render, act, fireEvent, waitFor } from '@testing-library/react-native';

function Mini() {
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    setMsg('boom');
  }
  return (
    <>
      <Pressable testID="go" onPress={save}>
        <Text>go</Text>
      </Pressable>
      {msg && <Text testID="msg">{msg}</Text>}
    </>
  );
}

describe('harness control', () => {
  it('a sync setState inside an async handler renders', async () => {
    const view = await render(<Mini />);
    fireEvent.press(view.getByTestId('go'));
    await act(async () => {});
    await waitFor(() => expect(view.queryByTestId('msg')).not.toBeNull(), { timeout: 2000 });
    expect(view.getByTestId('msg').props.children).toBe('boom');
  });

  it('the same, driven through the handler prop rather than fireEvent', async () => {
    const view = await render(<Mini />);
    await act(async () => {
      await view.getByTestId('go').props.onPress();
    });
    await waitFor(() => expect(view.queryByTestId('msg')).not.toBeNull(), { timeout: 2000 });
    expect(view.getByTestId('msg').props.children).toBe('boom');
  });
});
