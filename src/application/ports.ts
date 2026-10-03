import type {
  DeliveryDestination,
  DiscoveredMedia,
  DownloadedMedia,
  DownloadLimits,
  MediaRepresentation,
  PreparedMedia,
  ProcessingBudget,
  ProcessExecution,
  ProcessExecutionResult,
  SafeHttpDownload,
  TemporaryWorkspace,
  AdmissionPermit,
} from './models.js';
import type { OperationContext } from './operation-context.js';
import type { ErrorCode } from '../shared/errors.js';
import type { RequestId } from '../shared/identifiers.js';
export type { MediaProvider } from '../providers/media-provider.js';

export interface MediaDownloader {
  download(
    input: Readonly<{
      representation: MediaRepresentation;
      media: DiscoveredMedia;
      workspace: TemporaryWorkspace;
      limits: DownloadLimits;
      signal: AbortSignal;
    }>,
  ): Promise<DownloadedMedia>;
}

export interface MediaProcessor {
  prepare(
    media: DownloadedMedia,
    context: OperationContext,
    workspace: TemporaryWorkspace,
    budget: ProcessingBudget,
  ): Promise<PreparedMedia>;
}

export type DeliveryReceipt = Readonly<{ itemPosition: number }>;

export interface MediaDelivery {
  deliver(
    destination: DeliveryDestination,
    media: PreparedMedia,
    context: OperationContext,
  ): Promise<DeliveryReceipt>;
}

export interface ProcessRunnerPort {
  run(request: ProcessExecution): Promise<ProcessExecutionResult>;
  checkVersion(executable: string): Promise<string>;
}

export interface TemporaryWorkspacePort {
  create(requestId: RequestId): Promise<TemporaryWorkspace>;
  cleanup(workspace: TemporaryWorkspace): Promise<void>;
}

export interface AdmissionControlPort {
  acquire(
    input: Readonly<{
      requestId: RequestId;
      deadlineAt: number;
      signal: AbortSignal;
    }>,
  ): Promise<AdmissionPermit>;
}

export interface SafeHttpClientPort {
  downloadToFile(input: SafeHttpDownload): Promise<number>;
}

export interface LifecycleLogger {
  info(fields: Readonly<Record<string, unknown>>, message?: string): void;
  warn(fields: Readonly<Record<string, unknown>>, message?: string): void;
  error(fields: Readonly<Record<string, unknown>>, message?: string): void;
}

export type UserSafeError = ErrorCode;
