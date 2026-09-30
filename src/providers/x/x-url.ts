import type { PostReference } from '../../application/models.js';
import { applicationError } from '../../shared/errors.js';

const ALLOWED_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);
const STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/([1-9][0-9]{0,19})$/;
const MAX_CANDIDATE_LENGTH = 2_048;

export function recognizesXPostUrl(candidate: URL): boolean {
  return ALLOWED_HOSTS.has(candidate.hostname.toLowerCase());
}

export function parseXPostUrl(value: string): PostReference {
  if (value.length === 0 || value.length > MAX_CANDIDATE_LENGTH) {
    throw applicationError('InvalidUrl', 'input');
  }

  let candidate: URL;
  try {
    candidate = new URL(value);
  } catch {
    throw applicationError('InvalidUrl', 'input');
  }

  const rawPath = rawPathFromSubmittedUrl(value);
  const match = rawPath === undefined ? null : STATUS_PATH.exec(rawPath);
  if (
    candidate.protocol !== 'https:' ||
    !recognizesXPostUrl(candidate) ||
    candidate.username !== '' ||
    candidate.password !== '' ||
    (candidate.port !== '' && candidate.port !== '443') ||
    !match
  ) {
    throw applicationError('UnsupportedPostUrl', 'input');
  }

  candidate.search = '';
  candidate.hash = '';
  return {
    provider: 'x',
    postId: match[2] ?? '',
    canonicalUrl: candidate,
  };
}

function rawPathFromSubmittedUrl(value: string): string | undefined {
  const match = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/u.exec(value);
  return match?.[1];
}
