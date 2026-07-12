// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Disclosure } from './Disclosure';

describe('Disclosure', () => {
  afterEach(cleanup);

  it('toggles open/closed from the trigger, wiring aria-expanded/aria-controls', () => {
    render(
      <Disclosure title="Engine">
        <p>panel content</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole('button', { name: /Engine/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('panel content')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByText('panel content');
    expect(trigger.getAttribute('aria-controls')).toBe(panel.parentElement!.id);
  });

  it('Escape inside the open region closes it and returns focus to the trigger', () => {
    render(
      <Disclosure title="Engine" defaultOpen>
        <button>inner</button>
      </Disclosure>,
    );
    const trigger = screen.getByRole('button', { name: /Engine/ });
    fireEvent.keyDown(screen.getByRole('button', { name: 'inner' }), { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('a defaultPrevented Escape (child already consumed it) does NOT close the disclosure', () => {
    render(
      <Disclosure title="Engine" defaultOpen>
        {/* stand-in for a dropdown/combobox/dialog that consumes Escape itself */}
        <button onKeyDown={(e) => e.key === 'Escape' && e.preventDefault()}>inner</button>
      </Disclosure>,
    );
    const trigger = screen.getByRole('button', { name: /Engine/ });
    fireEvent.keyDown(screen.getByRole('button', { name: 'inner' }), { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'inner' })).toBeTruthy();
  });

  it('function children stay mounted while closed and receive the open state', () => {
    render(
      <Disclosure title="Explorer">
        {(open) => <p data-testid="probe">{open ? 'active' : 'idle'}</p>}
      </Disclosure>,
    );
    // Mounted (hidden) while closed — a fetch-gated panel keeps its state.
    expect(screen.getByTestId('probe').textContent).toBe('idle');
    expect((screen.getByTestId('probe').parentElement as HTMLElement).hidden).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Explorer/ }));
    expect(screen.getByTestId('probe').textContent).toBe('active');
    expect((screen.getByTestId('probe').parentElement as HTMLElement).hidden).toBe(false);
  });
});
