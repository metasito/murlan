import { describe, it, expect } from '@jest/globals';
import { Platform } from 'react-native';
import { Shadow } from '@/lib/theme';

// lib/theme.ts branches on Platform.OS: web gets a boxShadow string, native
// gets the discrete shadow props. The web suite only ever exercises the first
// branch, so the native one is unverified everywhere else.
describe('Shadow is platform-aware', () => {
  it('runs under a native platform', () => {
    expect(['ios', 'android']).toContain(Platform.OS);
  });

  it.each(Object.keys(Shadow))('%s uses native shadow props, not boxShadow', (key) => {
    const style = Shadow[key as keyof typeof Shadow];
    expect(style).not.toHaveProperty('boxShadow');
    expect(style).toMatchObject({
      shadowColor: expect.any(String),
      shadowOffset: { width: expect.any(Number), height: expect.any(Number) },
      shadowOpacity: expect.any(Number),
      shadowRadius: expect.any(Number),
      elevation: expect.any(Number),
    });
  });
});
