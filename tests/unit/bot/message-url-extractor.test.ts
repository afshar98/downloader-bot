import { describe, expect, it } from 'vitest';
import { extractSingleCandidate } from '../../../src/bot/message-url-extractor.js';

describe('message URL extraction', () => {
  it.each([
    ['Please download https://x.com/user/status/123. Thanks!', 'https://x.com/user/status/123'],
    ['[post](https://twitter.com/user/status/456)', 'https://twitter.com/user/status/456'],
    [
      'Look: <https://x.com/user/status/789?from=chat#post>',
      'https://x.com/user/status/789?from=chat#post',
    ],
    ['https://x.com/user/status/123...,', 'https://x.com/user/status/123'],
  ])('extracts one candidate from surrounding text: %s', (message, expected) => {
    expect(extractSingleCandidate(message)).toBe(expected);
  });

  it.each([
    '',
    'There is no link here',
    'x.com/user/status/1',
    'https://x.com/user/status/1 https://t.co/abc',
    'https://t.co/abc and a malformed http://',
    'https://x.com/user/status/1 https://',
    'https://x.com/user/status/1',
    'https://x.com/user/status/1' + 'x'.repeat(2_050),
  ])('rejects no, multiple, or over-limit candidates: %s', (message) => {
    if (message === 'https://x.com/user/status/1') {
      expect(extractSingleCandidate(message)).toBe(message);
      return;
    }
    expect(() => extractSingleCandidate(message)).toThrow(
      expect.objectContaining({ code: 'InvalidUrl' }),
    );
  });

  it('does not repair split, joined, or Unicode-obscured URLs', () => {
    expect(extractSingleCandidate('https://x.com/user/status/ 1')).toBe(
      'https://x.com/user/status/',
    );
    expect(() => extractSingleCandidate('prefixhttps://x.com/user/status/1')).toThrow(
      expect.objectContaining({ code: 'InvalidUrl' }),
    );
    expect(() => extractSingleCandidate('https://x.com/usér/status/1')).toThrow(
      expect.objectContaining({ code: 'InvalidUrl' }),
    );
    expect(() =>
      extractSingleCandidate(`text ${'x'.repeat(4_097)} https://x.com/a/status/1`),
    ).toThrow(expect.objectContaining({ code: 'InvalidUrl' }));
  });
});
