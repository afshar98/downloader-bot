import { describe, expect, it } from 'vitest';
import { createRequestId } from '../../../src/shared/identifiers.js';

describe('request identifiers', () => {
  it('creates opaque unique identifiers unrelated to user input', () => {
    const first = createRequestId();
    const second = createRequestId();

    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(second).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first).not.toBe(second);
    expect(first).not.toMatch(/chat|url|user/i);
  });
});
