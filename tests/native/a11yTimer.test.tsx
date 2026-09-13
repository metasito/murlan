// tests/native/a11yTimer.test.tsx — a named countdown needs a different half on
// each platform, and only one of the two is `accessible`. Sibling of
// tests/native/a11yGroup.test.tsx, which pins the container form.
import { describe, it, expect } from '@jest/globals';
import { a11yTimer } from '@/lib/a11y';

describe('a11yTimer', () => {
  it('makes the text an accessibility element and names it', () => {
    expect(a11yTimer('12 seconds left to play.')).toMatchObject({
      accessible: true,
      accessibilityLabel: '12 seconds left to play.',
    });
  });

  // These projects run as ios and android, where the DOM role would be
  // meaningless. The web half — `role="timer"`, without which the name lands on
  // a role-less <span> and is prohibited — is true or false only in a browser.
  it('carries no DOM role on native', () => {
    expect(a11yTimer('12 seconds left to play.')).not.toHaveProperty('role');
  });
});
