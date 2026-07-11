/**
 * lib/srs.ts → i18n bridge (same pattern as lib/gameStatusText.ts).
 *
 * `dueLabel()` in lib/srs.ts stays canonical English ('new' / 'due' / 'soon' /
 * '3d' / '5h'): its unit test asserts the exact strings and pages compare the
 * value literally (`cd === 'due'` drives styling). Render sites translate the
 * label through this module at DISPLAY time only; unknown strings pass
 * through unchanged, so English output stays byte-identical.
 *
 * Components calling this should hold a `useTranslation(...)` subscription so
 * they re-render when the language changes.
 */
import i18n from '../i18n';

const PLAIN_KEYS: Record<string, string> = {
  new: 'common:srs.new',
  due: 'common:srs.due',
  soon: 'common:srs.soon',
};

/** Translate a `dueLabel()` value; unknown strings pass through unchanged. */
export function dueDisplayLabel(label: string): string {
  const key = PLAIN_KEYS[label];
  if (key) return i18n.t(key, { defaultValue: label });
  const timed = /^(\d+)([dh])$/.exec(label);
  if (timed) {
    const count = Number(timed[1]);
    const unitKey = timed[2] === 'd' ? 'common:srs.days' : 'common:srs.hours';
    return i18n.t(unitKey, { count, defaultValue: label });
  }
  return label;
}
