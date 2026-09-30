import { describe, expect, it } from 'vitest';
import { parseXPostUrl, recognizesXPostUrl } from '../../../../src/providers/x/x-url.js';

describe('X post URL validation', () => {
  it.each([
    'https://x.com/user/status/1',
    'https://www.x.com/User_1/status/12345678901234567890',
    'https://twitter.com/user/status/99?ref=share#post',
    'https://www.twitter.com/user/status/5',
  ])('accepts an allowlisted status URL %s', (value) => {
    const result = parseXPostUrl(value);
    expect(result.provider).toBe('x');
    expect(result.postId).toMatch(/^[1-9][0-9]{0,19}$/);
    expect(result.canonicalUrl.search).toBe('');
    expect(result.canonicalUrl.hash).toBe('');
  });

  it.each([
    'https://mobile.twitter.com/user/status/1',
    'https://t.co/abc',
    'http://x.com/user/status/1',
    'https://user:pass@x.com/user/status/1',
    'https://x.com:8443/user/status/1',
    'https://x.com/user/status/1/',
    'https://x.com/user/status/1/photo/1',
    'https://x.com/user/../user/status/1',
    'https://x.com/user/./status/1',
    'https://x.com/user/status/1/..',
    'https://x.com/user/%2e%2e/user/status/1',
    'https://x.com/user%2fname/status/1',
    'https://x.com/üser/status/1',
    'https://x.com/abcdefghijklmnop/status/1',
    'https://x.com/user/status/0',
    'https://x.com/user/status/123456789012345678901',
  ])('rejects a valid but unsupported URL as UnsupportedPostUrl: %s', (value) => {
    expect(() => parseXPostUrl(value)).toThrow(
      expect.objectContaining({ code: 'UnsupportedPostUrl' }),
    );
  });

  it.each(['not a URL', 'https://', 'https://x.com/' + 'a'.repeat(2_050)])(
    'classifies malformed or overlong input as InvalidUrl',
    (value) => {
      expect(() => parseXPostUrl(value)).toThrow(expect.objectContaining({ code: 'InvalidUrl' }));
    },
  );

  it('recognizes only the supported X/Twitter hosts', () => {
    expect(recognizesXPostUrl(new URL('https://www.x.com/a/status/1'))).toBe(true);
    expect(recognizesXPostUrl(new URL('https://mobile.twitter.com/a/status/1'))).toBe(false);
  });
});
