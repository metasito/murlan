type Equal<T> = (a: T, b: T) => boolean;

/** Two cards are the same card by id: every `game:state` rebuilds every card object. */
export const byId: Equal<{ id: string }> = (a, b) => a.id === b.id;

/** The same keys holding the same values, one level down. */
export function shallowEqual<T extends object | null | undefined>(a: T, b: T): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(
    (k) => Object.prototype.hasOwnProperty.call(b, k) && (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]
  );
}

/**
 * A `React.memo` comparator that compares every prop either side carries by identity, except the
 * ones named, which are compared by their own test. A prop nobody names is compared, so adding one
 * cannot make the component ignore it.
 */
export function propsEqualExcept<P extends object>(except: { [K in keyof P]?: Equal<P[K]> }): Equal<P> {
  return (a, b) => {
    const pa = a as Record<string, unknown>;
    const pb = b as Record<string, unknown>;
    const tests = except as Record<string, Equal<unknown> | undefined>;
    const keys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
    for (const k of keys) {
      const test = tests[k];
      if (test ? !test(pa[k], pb[k]) : pa[k] !== pb[k]) return false;
    }
    return true;
  };
}
