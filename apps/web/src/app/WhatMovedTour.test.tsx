// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../i18n'; // initialize i18next so t() serves the bundled English strings
import { WhatMovedTour, computeTourGate, resetTourGateForTests } from './WhatMovedTour';

const V2_KEY = 'chesser-ia-tour-v2';
const LEGACY_KEY = 'chesser-ia-tour';

describe('WhatMovedTour gate + dialog (jsdom)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    resetTourGateForTests();
  });

  it('marks a brand-new browser and never shows the tour, even after state appears', () => {
    expect(computeTourGate()).toBe(false);
    expect(localStorage.getItem(V2_KEY)).toBe('new-user');
    // The session then writes its own store state — still no tour.
    localStorage.setItem('chesser-settings', '{}');
    expect(computeTourGate()).toBe(false);
  });

  it('phase-1 "new-user" browsers never see the finished tour', () => {
    localStorage.setItem(LEGACY_KEY, 'new-user');
    localStorage.setItem('chesser-settings', '{}');
    expect(computeTourGate()).toBe(false);
    expect(localStorage.getItem(V2_KEY)).toBe('new-user');
  });

  it('pre-IA users who dismissed the phase-1 interim note still get the tour once', () => {
    localStorage.setItem(LEGACY_KEY, 'dismissed');
    expect(computeTourGate()).toBe(true);
  });

  it('steps through with visible progress; "Got it" persists and it never reappears', () => {
    localStorage.setItem('chesser-streak', '{}'); // pre-IA evidence
    resetTourGateForTests();
    render(<WhatMovedTour />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Things moved around')).toBeTruthy();
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // The surprising move is called out explicitly on the Profile step.
    expect(screen.getByText(/Archive → Profile/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 4 of 4')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(V2_KEY)).toBe('dismissed');

    cleanup();
    resetTourGateForTests();
    render(<WhatMovedTour />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape dismisses and persists the flag', () => {
    localStorage.setItem(LEGACY_KEY, 'dismissed');
    resetTourGateForTests();
    render(<WhatMovedTour />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(V2_KEY)).toBe('dismissed');
  });
});
