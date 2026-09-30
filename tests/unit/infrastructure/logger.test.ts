import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/infrastructure/logger.js';

describe('structured logger', () => {
  it('retains correlation and stage fields while redacting sensitive data', async () => {
    const destination = new PassThrough();
    const chunks: string[] = [];
    destination.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
    const logger = createLogger({ level: 'info', destination });

    logger.info(
      {
        requestId: 'req_123',
        stage: 'download',
        itemPosition: 2,
        token: 'bot-secret',
        telegramBotToken: 'bot-secret',
        url: 'https://x.example/private-post',
        messageText: 'download https://x.example/private-post',
        payload: 'private update',
        path: '/tmp/work/item.mp4',
        processOutput: 'secret provider output',
      },
      'media download finished',
    );
    destination.end();
    await new Promise<void>((resolve) => destination.once('end', resolve));

    const record = JSON.parse(chunks.join('')) as Record<string, unknown>;
    expect(record).toMatchObject({ requestId: 'req_123', stage: 'download', itemPosition: 2 });
    expect(JSON.stringify(record)).not.toMatch(
      /bot-secret|private-post|private update|\/tmp\/work|secret provider output/,
    );
  });

  it('creates child loggers with bounded correlation context', async () => {
    const destination = new PassThrough();
    const chunks: string[] = [];
    destination.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
    const logger = createLogger({ level: 'info', destination }).child({
      requestId: 'req_456',
      stage: 'provider',
    });
    logger.info({ code: 'MediaNotFound' }, 'discovery finished');
    destination.end();
    await new Promise<void>((resolve) => destination.once('end', resolve));

    expect(JSON.parse(chunks.join(''))).toMatchObject({
      requestId: 'req_456',
      stage: 'provider',
      code: 'MediaNotFound',
    });
  });
});
