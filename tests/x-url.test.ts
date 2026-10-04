import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { parseXStatusUrl } from '../src/x-url.js';

describe('parseXStatusUrl', () => {
  it.each([
    ['https://x.com/name/status/123456789', 'https://x.com/name/status/123456789'],
    ['https://www.x.com/i/status/123456789?ref=share#media', 'https://x.com/i/status/123456789'],
    ['https://twitter.com/name/status/123456789', 'https://x.com/name/status/123456789'],
    ['https://www.twitter.com/name/status/123456789', 'https://x.com/name/status/123456789'],
    ['https://X.COM/name/status/123456789', 'https://x.com/name/status/123456789'],
  ])('canonicalizes %s', (candidate, canonicalUrl) => {
    expect(parseXStatusUrl(candidate)).toEqual({ canonicalUrl, statusId: '123456789' });
  });

  it.each([
    'http://x.com/name/status/123456789',
    'https://mobile.twitter.com/name/status/123456789',
    'https://t.co/abc123',
    'https://x.com.evil.example/name/status/123456789',
    'https://name@x.com/name/status/123456789',
    'https://x.com:8443/name/status/123456789',
    'https://x.com/name/status/not-a-number',
    'https://x.com/name/status/123456789/anything',
  ])('rejects unsupported URL form %s', (candidate) => {
    expect(() => parseXStatusUrl(candidate)).toThrowError(
      expect.objectContaining({ code: 'unsupported-url' }),
    );
  });

  it('classifies an unparsable URL as invalid', () => {
    try {
      parseXStatusUrl('https://');
      throw new Error('expected URL parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'invalid-url' });
    }
  });
});
