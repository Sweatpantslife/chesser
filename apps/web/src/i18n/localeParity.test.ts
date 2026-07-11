/**
 * Locale key parity: every non-English locale under src/locales/ must mirror
 * the English source exactly — same namespace files, same key paths (no
 * missing, no extra), and the same {{placeholder}} variables per key.
 *
 * Locale directories are discovered from the filesystem, so a newly added
 * language is covered automatically with zero test changes.
 *
 * Plural forms (key_one / key_other / …) are normalised to `key_[plural]`
 * before comparing: languages have different CLDR plural categories, so a
 * locale must translate every plural GROUP English has, but may use its own
 * set of category suffixes.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales');
const SOURCE = 'en';
const PLURAL_SUFFIXES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

function localeDirs(): string[] {
  return readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function namespaceFiles(locale: string): string[] {
  return readdirSync(join(LOCALES_DIR, locale))
    .filter((f) => f.endsWith('.json'))
    .sort();
}

function readNamespace(locale: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, locale, file), 'utf8')) as Record<string, unknown>;
}

/** Flatten to dotted leaf paths, e.g. "toasts.freezeUsed.body_one" → value. */
function leaves(obj: Record<string, unknown>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(path, value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [p, v] of leaves(value as Record<string, unknown>, path)) out.set(p, v);
    } else {
      throw new Error(`Unsupported value at ${path}: translation files must contain only strings and objects`);
    }
  }
  return out;
}

/** "body_one" → "body_[plural]"; non-plural keys pass through unchanged. */
function normalisePlural(path: string): string {
  const at = path.lastIndexOf('_');
  if (at === -1) return path;
  const suffix = path.slice(at + 1);
  return PLURAL_SUFFIXES.has(suffix) ? `${path.slice(0, at)}_[plural]` : path;
}

/** Normalised key → union of {{placeholders}} across its plural variants. */
function keyShapes(flat: Map<string, string>): Map<string, Set<string>> {
  const shapes = new Map<string, Set<string>>();
  for (const [path, value] of flat) {
    const key = normalisePlural(path);
    const vars = shapes.get(key) ?? new Set<string>();
    for (const m of value.matchAll(/\{\{\s*([^,}]+?)\s*(?:,[^}]*)?\}\}/g)) {
      if (m[1]) vars.add(m[1]);
    }
    shapes.set(key, vars);
  }
  return shapes;
}

describe('locale key parity', () => {
  const locales = localeDirs();
  const targets = locales.filter((l) => l !== SOURCE);

  it('has an English source and at least one namespace', () => {
    expect(locales).toContain(SOURCE);
    expect(namespaceFiles(SOURCE).length).toBeGreaterThan(0);
  });

  for (const locale of targets) {
    describe(locale, () => {
      it('ships exactly the same namespace files as English', () => {
        expect(namespaceFiles(locale)).toEqual(namespaceFiles(SOURCE));
      });

      for (const file of namespaceFiles(SOURCE)) {
        it(`${file}: same keys and placeholders as English`, () => {
          const source = keyShapes(leaves(readNamespace(SOURCE, file)));
          const target = keyShapes(leaves(readNamespace(locale, file)));

          const missing = [...source.keys()].filter((k) => !target.has(k));
          const extra = [...target.keys()].filter((k) => !source.has(k));
          expect(missing, `keys missing from ${locale}/${file}`).toEqual([]);
          expect(extra, `keys in ${locale}/${file} that don't exist in ${SOURCE}/${file}`).toEqual([]);

          for (const [key, sourceVars] of source) {
            const targetVars = target.get(key);
            if (!targetVars) continue; // already reported as missing
            expect([...targetVars].sort(), `placeholders for "${key}" in ${locale}/${file}`).toEqual(
              [...sourceVars].sort(),
            );
          }
        });
      }
    });
  }
});
