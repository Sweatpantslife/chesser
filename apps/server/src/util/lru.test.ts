import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LruCache } from './lru.js';

test('stores and retrieves values', () => {
  const c = new LruCache<string, number>(3);
  c.set('a', 1);
  c.set('b', 2);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('b'), 2);
  assert.equal(c.get('missing'), undefined);
  assert.equal(c.size, 2);
});

test('evicts the least-recently-used entry beyond max', () => {
  const c = new LruCache<string, number>(2);
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3); // evicts 'a'
  assert.equal(c.get('a'), undefined);
  assert.equal(c.get('b'), 2);
  assert.equal(c.get('c'), 3);
  assert.equal(c.size, 2);
});

test('get refreshes recency so hot entries survive', () => {
  const c = new LruCache<string, number>(2);
  c.set('a', 1);
  c.set('b', 2);
  c.get('a'); // 'a' is now most recent; 'b' is LRU
  c.set('c', 3); // evicts 'b'
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('c'), 3);
});

test('set overwrites in place and refreshes recency', () => {
  const c = new LruCache<string, number>(2);
  c.set('a', 1);
  c.set('b', 2);
  c.set('a', 10); // overwrite; 'b' becomes LRU
  c.set('c', 3); // evicts 'b'
  assert.equal(c.get('a'), 10);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.size, 2);
});

test('rejects a non-positive max', () => {
  assert.throws(() => new LruCache(0));
  assert.throws(() => new LruCache(-5));
  assert.throws(() => new LruCache(1.5));
});
