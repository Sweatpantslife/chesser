// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18n, { languageDisplayName, setLanguage, SUPPORTED_LANGUAGES } from './index';
import { formatDate, formatNumber } from './format';
import { ConsentNotice } from '../components/ConsentNotice';

describe('i18n runtime (jsdom)', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await setLanguage('en');
  });
  afterEach(async () => {
    cleanup();
    window.localStorage.clear();
    await setLanguage('en');
  });

  it('discovers locale directories and self-names them', () => {
    expect(SUPPORTED_LANGUAGES).toContain('en');
    expect(SUPPORTED_LANGUAGES).toContain('es');
    expect(languageDisplayName('en')).toBe('English');
    expect(languageDisplayName('es')).toBe('Español');
  });

  it('renders bundled English immediately, including <Trans> markup', () => {
    render(<ConsentNotice />);
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
    // The <policyLink> tag becomes a real anchor around the link text only.
    const link = screen.getByRole('link', { name: 'Privacy Policy' });
    expect(link.getAttribute('href')).toBe('#/privacy');
  });

  it('lazy-loads a locale on switch, persists the choice and updates <html lang>', async () => {
    render(<ConsentNotice />);
    await setLanguage('es');
    expect(await screen.findByRole('button', { name: 'Entendido' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Política de privacidad' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('es');
    expect(window.localStorage.getItem('chesser-lang')).toBe('es');
  });

  it('applies the locale plural rules (freeze toast copy)', async () => {
    expect(i18n.t('gamify:toasts.freezeUsed.body', { streak: 7, count: 1 })).toBe(
      'Your 7-day streak survived · 1 freeze left',
    );
    expect(i18n.t('gamify:toasts.freezeUsed.body', { streak: 7, count: 2 })).toBe(
      'Your 7-day streak survived · 2 freezes left',
    );
    await setLanguage('es');
    expect(i18n.t('gamify:toasts.freezeUsed.body', { streak: 7, count: 1 })).toBe(
      'Tu racha de 7 días sobrevivió · queda 1 protector',
    );
  });

  it('formats numbers and dates per locale via Intl', () => {
    expect(formatNumber('en', 12345.6)).toBe('12,345.6');
    expect(formatNumber('es', 12345.6)).toBe('12.345,6');
    const day = Date.UTC(2026, 6, 11);
    expect(formatDate('en', day, { month: 'long', timeZone: 'UTC' })).toBe('July');
    expect(formatDate('es', day, { month: 'long', timeZone: 'UTC' })).toBe('julio');
  });
});
