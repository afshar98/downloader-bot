import { AppError } from './errors.js';

const X_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);
const STATUS_PATH = /^\/([^/]+)\/status\/(\d+)$/;

export type XStatusReference = Readonly<{
  canonicalUrl: string;
  statusId: string;
}>;

export function parseXStatusUrl(candidate: string): XStatusReference {
  let url: URL;
  try {
    url = new URL(candidate.trim());
  } catch (cause) {
    throw new AppError('invalid-url', 'The URL is malformed', { cause });
  }

  if (
    url.protocol !== 'https:' ||
    !X_HOSTS.has(url.hostname.toLowerCase()) ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    throw new AppError('unsupported-url', 'Only supported public X status URLs are accepted');
  }

  const match = STATUS_PATH.exec(url.pathname);
  if (!match) throw new AppError('unsupported-url', 'The URL is not an X status link');

  const username = match[1];
  const statusId = match[2];
  if (!username || !statusId) throw new AppError('unsupported-url', 'The URL is not an X status link');

  return {
    canonicalUrl: `https://x.com/${username}/status/${statusId}`,
    statusId,
  };
}
