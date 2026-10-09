// A view under `display: none` reports a 0x0 layout on web; the gradient must keep the angle it
// will paint with once shown, or its first visible frame waits on a real-time ResizeObserver (#1411).
import { describe, it, expect } from '@jest/globals';
import { act, render, fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import NativeLinearGradient from 'expo-linear-gradient/build/NativeLinearGradient.web';

const backgroundOf = () => StyleSheet.flatten(screen.getByTestId('gradient').props.style).backgroundImage;
const layOut = (width: number, height: number) =>
  act(async () => {
    fireEvent(screen.getByTestId('gradient'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height } } });
  });

describe('expo-linear-gradient on web', () => {
  it('keeps a diagonal angle through a 0x0 layout', async () => {
    await render(<NativeLinearGradient testID="gradient" colors={['#12402A', '#061C12']} startPoint={[0, 0]} endPoint={[1, 1]} />);
    expect(backgroundOf()).toContain('135deg');
    await layOut(0, 0);
    expect(backgroundOf()).toContain('135deg');
    await layOut(16, 16);
    expect(backgroundOf()).toContain('135deg');
  });

  it('keeps a vertical angle through a 0x0 layout', async () => {
    await render(<NativeLinearGradient testID="gradient" colors={['#12402A', '#061C12']} />);
    expect(backgroundOf()).toContain('180deg');
    await layOut(0, 0);
    expect(backgroundOf()).toContain('180deg');
  });
});
