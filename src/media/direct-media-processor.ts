import type { MediaProcessor as MediaProcessorPort } from '../application/ports.js';
import type {
  DownloadedMedia,
  PreparedMedia,
  ProcessingBudget,
  TemporaryWorkspace,
} from '../application/models.js';
import { applicationError } from '../shared/errors.js';
import type { OperationContext } from '../application/operation-context.js';

export type DirectMediaProcessorOptions = Readonly<{ maxMediaBytes: number }>;

export class DirectMediaProcessor implements MediaProcessorPort {
  constructor(private readonly options: DirectMediaProcessorOptions) {}

  async prepare(
    media: DownloadedMedia,
    _context?: OperationContext,
    _workspace?: TemporaryWorkspace,
    _budget?: ProcessingBudget,
  ): Promise<PreparedMedia> {
    if (media.sizeBytes > this.options.maxMediaBytes) {
      throw applicationError('MediaTooLarge', 'processing');
    }
    if (media.sizeBytes < 1 || media.container !== 'mp4' || !media.path.endsWith('.mp4')) {
      throw applicationError('MediaProcessingFailed', 'processing');
    }
    if (media.audioPresence === 'absent') {
      throw applicationError('MediaProcessingFailed', 'processing');
    }
    return {
      downloaded: media,
      deliveryKind: 'video',
      deliveryContainer: 'mp4',
      deliveryPath: media.path,
      deliverySizeBytes: media.sizeBytes,
      transformed: false,
    };
  }
}
