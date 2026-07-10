// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, resolveTheme } from '../lib/theme';
import { useSettings } from './settings';

/** Minimal matchMedia stub; returns the captured change-listener list. */
function stubMatchMedia(prefersLight: boolean) {
  const listeners: Array<(e: { matches: boolean }) => void> = [];
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('light') ? prefersLight : !prefersLight,
    media: query,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
  }));
  return listeners;
}

describe('resolveTheme', () => {
  it('passes explicit prefs through and resolves system via prefers-color-scheme', () => {
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });
});

describe('settings store: theme', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useSettings.getState().setTheme('dark');
  });

  it('defaults to dark', () => {
    expect(useSettings.getState().theme).toBe('dark');
  });

  it('setTheme stamps <html data-theme> and persists the choice', () => {
    useSettings.getState().setTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(useSettings.getState().theme).toBe('light');
    const persisted = JSON.parse(localStorage.getItem('chesser-settings')!);
    expect(persisted.state.theme).toBe('light');

    useSettings.getState().setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(JSON.parse(localStorage.getItem('chesser-settings')!).state.theme).toBe('dark');
  });

  it('system theme follows prefers-color-scheme, live', () => {
    const listeners = stubMatchMedia(true); // OS prefers light
    useSettings.getState().setTheme('system');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(listeners.length).toBe(1); // one live listener while pref is system

    // OS switches to dark → document follows without a new setTheme call.
    listeners.forEach((cb) => cb({ matches: false }));
    expect(document.documentElement.dataset.theme).toBe('dark');

    // Leaving system mode unhooks the listener.
    useSettings.getState().setTheme('dark');
    expect(listeners.length).toBe(0);
  });

  it('updates the PWA theme-color meta per resolved theme', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#141126');
    document.head.appendChild(meta);
    try {
      applyTheme('light');
      expect(meta.getAttribute('content')).toBe('#f1eefa');
      applyTheme('dark');
      expect(meta.getAttribute('content')).toBe('#141126');
    } finally {
      meta.remove();
    }
  });
});
