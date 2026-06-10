import NodeID3 from 'node-id3';
import { MediaType } from '../database/index.js';
import logger from '../logger/index.js';
import type { ExtractorContext, DownloadedFormat, MediaItem } from '../models/index.js';
import type { Plugin } from '../models/index.js';

interface ID3Tags {
  title?: string;
  artist?: string;
  image?: {
    mime: string;
    type: { id: number; name: string };
    description: string;
    imageBuffer: Buffer;
  };
}

export const id3Plugin: Plugin = {
  id: 'id3',
  async runFunc(ctx: ExtractorContext, item: MediaItem, downloadedFormat: DownloadedFormat): Promise<void> {
    const format = downloadedFormat.format;
    if (format.type !== MediaType.Audio) return;
    if (!format.title && !format.artist) return;

    const tags: ID3Tags = {
      title: format.title || undefined,
      artist: format.artist || undefined,
    };

    if (downloadedFormat.thumbnailFilePath) {
      try {
        const { readFileSync } = await import('fs');
        tags.image = {
          mime: 'image/jpeg',
          type: { id: 3, name: 'front cover' },
          description: 'cover',
          imageBuffer: readFileSync(downloadedFormat.thumbnailFilePath),
        };
      } catch {}
    }

    try {
      NodeID3.update(tags, downloadedFormat.filePath);
      logger.debug({ filePath: downloadedFormat.filePath }, 'wrote ID3 tags');
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'failed to write ID3 tags');
    }
  },
};
