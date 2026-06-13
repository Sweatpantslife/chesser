/**
 * Serialise async work against a shared resource (e.g. a single engine process
 * that can only run one search at a time). Calls keyed on the same object run
 * one after another in submission order.
 */
const tails = new WeakMap<object, Promise<unknown>>();

export function withLock<T>(key: object, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  tails.set(
    key,
    next.catch(() => {}),
  );
  return next;
}
