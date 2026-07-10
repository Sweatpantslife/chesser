import { describe, expect, it } from 'vitest';
import { classifyProfileError } from './socialApi';

describe('classifyProfileError', () => {
  it("maps the server's deliberate 404 message to 'missing'", () => {
    // The profile endpoint's one-404-fits-all body.
    expect(classifyProfileError(new Error('This profile is private or does not exist.'))).toBe('missing');
  });

  it("maps a bare 404 (no error body) to 'missing'", () => {
    // jsonOrThrow's fallback message when the body carried no `error`.
    expect(classifyProfileError(new Error('Request failed (404)'))).toBe('missing');
  });

  it("maps network and server failures to 'error', never 'missing'", () => {
    expect(classifyProfileError(new TypeError('Failed to fetch'))).toBe('error');
    expect(classifyProfileError(new Error('Request failed (500)'))).toBe('error');
    expect(classifyProfileError(new Error('Request failed (503)'))).toBe('error');
    expect(classifyProfileError('weird non-error rejection')).toBe('error');
    expect(classifyProfileError(undefined)).toBe('error');
  });
});
