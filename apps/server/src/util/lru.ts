/**
 * Minimal LRU map for in-memory response caches (e.g. tablebase probes keyed
 * by FEN). `get` refreshes recency; `set` evicts the least-recently-used entry
 * once `max` is exceeded. Backed by Map's insertion order — O(1) per op.
 */
export class LruCache<K, V> {
  private map = new Map<K, V>();

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new Error('LruCache: max must be a positive integer');
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    // re-insert to mark as most recently used
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }
}
