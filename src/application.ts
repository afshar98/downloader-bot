export type RequestInput = Readonly<{
  canonicalUrl: string;
  chatId: string;
}>;

export type RequestResult =
  | 'delivered'
  | 'invalid-url'
  | 'unsupported-url'
  | 'inaccessible'
  | 'no-animation'
  | 'failed'
  | 'cancelled';

export type ApplicationDependencies = Readonly<{
  handle(input: RequestInput, signal: AbortSignal): Promise<RequestResult>;
}>;

export function createApplication(dependencies: ApplicationDependencies): Readonly<{
  handleRequest(input: RequestInput, signal: AbortSignal): Promise<RequestResult>;
}> {
  return {
    handleRequest(input, signal) {
      return dependencies.handle(input, signal);
    },
  };
}
