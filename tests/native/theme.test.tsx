import { describe, it, expect, jest } from '@jest/globals';
import { Platform } from 'react-native';
import { CardShadow, makeLayeredShadow, makeShadow, Shadow } from '@/lib/theme';

// The card tokens take two shadows; every other token takes one, through the
// same `boxShadow` path.
const LAYERED = ['card', 'cardLifted', 'cardBack'];

function withAndroidVersion<T>(version: number, run: () => T): T {
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  const replaced = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(version);
  try {
    return run();
  } finally {
    replaced.mockRestore();
    os.restore();
  }
}

/** The shadows in a boxShadow list, as `[offsetY, radius, opacity]` each. */
function layersOf(key: string): { offsetY: number; radius: number; opacity: number }[] {
  const { boxShadow } = Shadow[key as keyof typeof Shadow] as { boxShadow: string };
  return boxShadow.split('), ').map((part) => {
    const [, offsetY, radius] = part.match(/^0px (-?[\d.]+)px ([\d.]+)px/) ?? [];
    const [, opacity] = part.match(/rgba\(\d+,\d+,\d+,([\d.]+)\)?$/) ?? [];
    return { offsetY: Number(offsetY), radius: Number(radius), opacity: Number(opacity) };
  });
}

describe('Shadow is platform-aware', () => {
  it('runs under a native platform', () => {
    expect(['ios', 'android']).toContain(Platform.OS);
  });

  it.each(Object.keys(Shadow).filter((k) => !LAYERED.includes(k)))('%s is a boxShadow', (key) => {
    const style = Shadow[key as keyof typeof Shadow];
    expect(style).toEqual({ boxShadow: expect.any(String) });
  });

  it('emits boxShadow on Android 9, where elevation 0 or a bare view would draw nothing', () => {
    const style = withAndroidVersion(28, () => makeShadow('#C9A84C', 2, 0, 0.5, 12, 0));
    expect(style).toEqual({ boxShadow: '2px 0px 12px rgba(201,168,76,0.5)' });
  });

  it('keeps the shadow props below Android 9, with an elevation no caller can zero', () => {
    const style = withAndroidVersion(26, () => makeShadow('#C9A84C', 0, 0, 0.5, 13, 0));
    expect(style).not.toHaveProperty('boxShadow');
    expect(style).toMatchObject({ shadowRadius: 13, shadowOpacity: 0.5, elevation: 7 });
  });
});

// Owner's ruling, #1966: cards lie skin to skin, so a card's own shadow is a thin contact line plus a tight
// cast on the felt; only a lifted card throws a visibly larger one.
describe('a card casts a thin contact shadow and a tight cast shadow', () => {
  it.each(LAYERED)('%s emits both, and no single-shadow leftovers', (key) => {
    const style = Shadow[key as keyof typeof Shadow];
    expect(layersOf(key)).toHaveLength(2);
    expect(style).not.toHaveProperty('shadowRadius');
    expect(style).not.toHaveProperty('elevation');
  });

  // Below Android 9 an outset `boxShadow` is ignored outright, so the layered
  // path there would leave a card with no shadow at all rather than one too
  // few. Skipped rather than quietly passing on the platform it cannot happen
  // on.
  const onAndroid = Platform.OS === 'android' ? it : it.skip;
  onAndroid('falls back to the cast shadow alone where boxShadow is ignored', () => {
    const replaced = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(26);
    try {
      const style = makeLayeredShadow(
        [
          { color: '#000000', offsetY: 1, opacity: 0.6, radius: 2 },
          { color: '#000000', offsetY: 6, opacity: 0.3, radius: 13 },
        ],
        14
      );
      expect(style).not.toHaveProperty('boxShadow');
      expect(style).toMatchObject({ shadowRadius: 13, shadowOpacity: 0.3, elevation: 14 });
    } finally {
      replaced.mockRestore();
    }
  });

  it.each(LAYERED)('%s takes the contact from the tokens: at most 0.5 pt down, 1 pt of blur, 0.35 of black', (key) => {
    const [contact] = layersOf(key);
    expect(contact.offsetY).toBe(CardShadow.contact.y);
    expect(contact.radius).toBe(CardShadow.contact.blur);
    expect(contact.offsetY).toBeLessThanOrEqual(0.5);
    expect(contact.radius).toBeLessThanOrEqual(1);
    expect(contact.opacity).toBeLessThanOrEqual(0.35);
  });

  it.each(['card', 'cardBack'])('%s rests on the felt with the tight cast', (key) => {
    const [, cast] = layersOf(key);
    expect(cast).toEqual({ offsetY: CardShadow.fall.drop, radius: CardShadow.cast.blur, opacity: CardShadow.cast.alpha });
  });

  it('keeps the lifted card visibly larger than a resting one, so lifting still reads', () => {
    const [, resting] = layersOf('card');
    const [, lifted] = layersOf('cardLifted');
    expect(lifted.offsetY).toBeGreaterThan(resting.offsetY);
    expect(lifted.radius).toBeGreaterThan(resting.radius);
  });
});
