// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

function Hello() {
  return <p>hello</p>;
}

describe('jsdom + testing-library', () => {
  it('renders a component', () => {
    render(<Hello />);
    expect(screen.getByText('hello')).toBeTruthy();
  });
});
