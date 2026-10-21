// tests/native/helpers/renderCounts.ts — a module whose components report each render, for a
// `jest.mock` factory: `jest.mock(path, () => require('./helpers/renderCounts').renderCounts(path, names, mockCount))`.
import { jest } from '@jest/globals';
import type React from 'react';

type Render = (p: object) => React.ReactNode;
type Memo = { type: Render; compare?: (a: object, b: object) => boolean };

/**
 * The module at `path`, with each component in `names` calling `count` as it renders.
 *
 * `'body'` counts the component's own body, inside its memo if it has one: a counter outside the
 * memo counts the parent instead. `'element'` counts every time a parent renders the element,
 * memo or not — what a test wants when it pins that the parent did not render at all.
 */
export function renderCounts(
  path: string,
  names: string[],
  count: (name: string, props: object) => void,
  at: 'body' | 'element' = 'body'
): Record<string, unknown> {
  const R = jest.requireActual('react') as typeof React;
  const actual = jest.requireActual(path) as Record<string, Render | Memo>;
  const wrap = (name: string) => {
    const c = actual[name];
    if (at === 'element') {
      return (p: object) => {
        count(name, p);
        return R.createElement(c as React.ComponentType<object>, p);
      };
    }
    const body = typeof c === 'function' ? c : c.type;
    const counted = (p: object) => {
      count(name, p);
      return body(p);
    };
    return typeof c === 'function' ? counted : R.memo(counted, c.compare);
  };
  return { ...actual, ...Object.fromEntries(names.map((name) => [name, wrap(name)])) };
}
