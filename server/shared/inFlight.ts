const inFlight = new Set<Promise<unknown>>();

/** Work nobody awaits (a presence write, a notice, a disconnect handler) is registered here, so `settleInFlight` can wait for it before the clients it uses close. */
export function track<T>(work: Promise<T>): Promise<T> {
  const settled = work.then(
    () => undefined,
    () => undefined
  );
  inFlight.add(settled);
  void settled.then(() => inFlight.delete(settled));
  return work;
}

export function inFlightCount(): number {
  return inFlight.size;
}

/** Resolves once everything tracked so far, and whatever it starts, has finished, or at `timeoutMs`. */
export async function settleInFlight(timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const everything = (async () => {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
  })();
  await Promise.race([everything, new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
  clearTimeout(timer);
}
