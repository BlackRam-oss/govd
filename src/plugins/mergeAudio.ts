import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Env } from '../config/index.js';
import { MediaType } from '../database/index.js';
import { mergeAudioVideo } from '../util/ffmpeg.js';
import logger from '../logger/index.js';
import type { Plugin } from '../models/index.js';
import type { ExtractorContext, MediaItem, DownloadedFormat } from '../models/index.js';

export const mergeAudioPlugin: Plugin = {
  id: 'merge_audio',
  async runFunc(ctx: ExtractorContext, item: MediaItem, downloadedFormat: DownloadedFormat): Promise<void> {
    const format = downloadedFormat.format;
    if (format.type !== MediaType.Video) return;

    const audioFormat = item.formats.find(f => f.type === MediaType.Audio && f !== format);
    if (!audioFormat || !audioFormat.url?.length) return;

    const { downloadFile, toPath } = await import('../util/download.js');

    const audioFileName = uuidv4().replace(/-/g, '') + '.m4a';
    const audioPath = await downloadFile(ctx, audioFormat.url, audioFileName, audioFormat.downloadSettings);

    const outputFileName = uuidv4().replace(/-/g, '') + '.mp4';
    const outputPath = toPath(outputFileName);
    ctx.filesTracker.add(outputPath);

    await mergeAudioVideo(downloadedFormat.filePath, audioPath, outputPath);

    downloadedFormat.filePath = outputPath;
    logger.debug({ outputPath }, 'merged audio into video');
  },
};
