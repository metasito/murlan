import { jest } from '@jest/globals';
import path from 'node:path';

export const OSES = ['ios', 'android', 'web'] as const;
export type OS = (typeof OSES)[number];
export type Variants = Map<string, Partial<Record<'base' | OS | 'native', string>>>;

/** The modules among `files` that have a platform variant, keyed by the name an import gives them. */
export function variantsOf(files: Iterable<string>): Variants {
  const found: Variants = new Map();
  for (const file of files) {
    const m = /^(.*)\.(ios|android|web|native)(\.[cm]?[jt]sx?)$/.exec(file);
    const key = m ? `${m[1]}${m[3]}` : file;
    found.set(key, { ...found.get(key), [m ? (m[2] as OS) : 'base']: file });
  }
  return new Map([...found].filter(([, v]) => Object.keys(v).some((k) => k !== 'base')));
}

type Variant = Variants extends Map<string, infer T> ? T : never;

/** The file of a module that `os` loads: the Metro order, `.web` before the plain file on web, `.native` after `.ios`/`.android`. */
export const loadedAs = (os: OS, v: Variant) =>
  os === 'web' ? (v.web ?? v.base) : os === 'android' ? (v.android ?? v.native ?? v.base) : (v.ios ?? v.native ?? v.base);

/** Makes every import of a module with variants load the one `os` takes, whichever file the project's own resolver found. */
export function loadVariantsAs(root: string, os: OS, variants: Variants) {
  for (const v of variants.values()) {
    const chosen = loadedAs(os, v);
    if (chosen) for (const file of Object.values(v)) jest.doMock(path.join(root, file), () => jest.requireActual(path.join(root, chosen)));
  }
}

export function restoreVariants(root: string, variants: Variants) {
  for (const v of variants.values()) for (const file of Object.values(v)) jest.dontMock(path.join(root, file));
}
