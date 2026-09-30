import { applicationError } from '../shared/errors.js';

const MAX_MESSAGE_LENGTH = 4_096;
const MAX_CANDIDATE_LENGTH = 2_048;
const URL_TOKEN = /https?:\/\/[^\s<>"'`,;]*/giu;
const TERMINAL_PUNCTUATION = /[.,!?;:)}\]]+$/u;

export function extractSingleCandidate(messageText: string): string {
  if (messageText.length > MAX_MESSAGE_LENGTH) {
    throw applicationError('InvalidUrl', 'input');
  }

  const tokens: string[] = [];
  for (const match of messageText.matchAll(URL_TOKEN)) {
    const candidate = match[0];
    const index = match.index;
    const preceding = index > 0 ? messageText[index - 1] : undefined;
    if (preceding && /[A-Za-z0-9+._-]/.test(preceding)) continue;
    tokens.push(candidate);
  }

  if (tokens.length !== 1) throw applicationError('InvalidUrl', 'input');

  const candidate = (tokens[0] ?? '').replace(TERMINAL_PUNCTUATION, '');
  if (
    candidate.length === 0 ||
    candidate.length > MAX_CANDIDATE_LENGTH ||
    !isPrintableAscii(candidate)
  ) {
    throw applicationError('InvalidUrl', 'input');
  }
  return candidate;
}

function isPrintableAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}
