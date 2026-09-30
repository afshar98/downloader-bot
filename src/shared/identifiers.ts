import { randomUUID } from 'node:crypto';

declare const requestIdBrand: unique symbol;
export type RequestId = string & { readonly [requestIdBrand]: true };

export function createRequestId(generate: () => string = randomUUID): RequestId {
  return generate() as RequestId;
}
