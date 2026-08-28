// tests/native/a11yGroup.test.tsx — a container that speaks as one node needs a
// different half on each platform, and only one of the two is `accessible`.
import { describe, it, expect } from '@jest/globals';
import { a11yGroup } from '@/lib/a11y';

describe('a11yGroup', () => {
  it('makes the view an accessibility element and names it', () => {
    expect(a11yGroup('Rank 1, Ana, 1200')).toMatchObject({
      accessible: true,
      accessibilityLabel: 'Rank 1, Ana, 1200',
    });
  });

  // These projects run as ios and android, where the DOM role would be
  // meaningless. The web half is asserted by the source scan in
  // tests/a11yLabels.test.ts and by the browser sweep, which are the only two
  // places it is true or false.
  it('carries no DOM role on native', () => {
    expect(a11yGroup('Rank 1, Ana, 1200')).not.toHaveProperty('role');
  });
});
