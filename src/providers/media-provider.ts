import type { DiscoveredMedia, PostReference } from '../application/models.js';
import type { OperationContext } from '../application/operation-context.js';

export interface MediaProvider {
  recognizes(candidate: URL): boolean;
  validate(candidate: string): PostReference;
  resolve(post: PostReference, context: OperationContext): Promise<readonly DiscoveredMedia[]>;
}
