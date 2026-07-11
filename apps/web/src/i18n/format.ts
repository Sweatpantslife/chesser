/**
 * Locale-aware number/date formatting built on Intl, reacting to the active
 * i18next language.
 *
 * In components, prefer the hook — it re-renders on language change:
 *
 *   const fmt = useLocaleFormat();
 *   fmt.number(12345.6);                       // "12,345.6" / "12.345,6"
 *   fmt.percent(0.62);                         // "62%"
 *   fmt.date(ts, { dateStyle: 'medium' });     // "Jul 11, 2026" / "11 jul 2026"
 *
 * Outside React (toasts, imperative code) use the plain functions with
 * `i18n.language`, or i18next's built-in Intl formatters in translations:
 * `"{{value, number}}"`, `"{{when, datetime(dateStyle: medium)}}"`.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export function formatNumber(locale: string, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatPercent(locale: string, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0, ...options }).format(value);
}

export function formatDate(locale: string, value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

export interface LocaleFormat {
  /** The active BCP-47 language code. */
  locale: string;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** `value` is a fraction: 0.62 → "62%". */
  percent: (value: number, options?: Intl.NumberFormatOptions) => string;
  date: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
}

/** Intl formatters bound to the active locale; re-renders on language change. */
export function useLocaleFormat(): LocaleFormat {
  const { i18n } = useTranslation();
  // The ACTIVE language, not resolvedLanguage: Intl needs no loaded resources,
  // and resolvedLanguage lags on the English fallback until the active
  // locale's lazy chunks land (it only updates when changeLanguage settles).
  const locale = i18n.language || i18n.resolvedLanguage || 'en';
  return useMemo(
    () => ({
      locale,
      number: (value, options) => formatNumber(locale, value, options),
      percent: (value, options) => formatPercent(locale, value, options),
      date: (value, options) => formatDate(locale, value, options),
    }),
    [locale],
  );
}
