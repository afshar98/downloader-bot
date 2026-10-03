import { readFileSync } from 'node:fs';

export const tinyGif = readFileSync(
  new URL('../../fixtures/media/tiny-silent.gif', import.meta.url),
);

export const tinyPngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
