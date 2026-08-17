import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '..', '..');
const SCANNED = ['app', 'components', 'context', 'lib'];

// lib/haptics.ts is the only module allowed to reach expo-haptics: it is what
// applies the Platform check and the user's haptics setting. A screen that
// imports expo-haptics directly buzzes the phone even with haptics switched
// off, and no web test can observe that — expo-haptics degrades to the Web
// Vibration API, which is inert on desktop.
const ALLOWED = 'lib/haptics.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('expo-haptics is reached only through lib/haptics', () => {
  const files = SCANNED.flatMap((d) => sourceFiles(join(ROOT, d)))
    .map((f) => relative(ROOT, f).split('\\').join('/'))
    .filter((f) => f !== ALLOWED);

  const offending = (pattern: RegExp) =>
    files.filter((f) => pattern.test(readFileSync(join(ROOT, f), 'utf8')));

  it('scans the whole UI surface', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no module imports expo-haptics', () => {
    expect(offending(/from\s+['"]expo-haptics['"]/)).toEqual([]);
  });

  it('no module calls the expo-haptics API directly', () => {
    expect(offending(/Haptics\.(impactAsync|selectionAsync|notificationAsync)/)).toEqual([]);
  });
});
