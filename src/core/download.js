import path from 'path';
import { DownloadedFormat } from '../models/index.js';
import { MediaType } from '../database/index.js';
import { exceedsMaxFileSize, exceedsMaxDuration, Errors } from '../util/index.js';
import { downloadFile, downloadFileInMemory, downloadFileWithSegments } from '../util/download.js';
import { bufferToJpeg } from '../util/image.js';
import { getVideoInfo, getThumbnail } from '../util/ffmpeg.js';
import { toPath } from '../util/download.js';
import logger from '../logger/index.js';

const CONCURRENCY = 3;

export async function downloadMediaFormats(ctx, media) {
  const numItems = media.items.length;
  const results = new Array(numItems);

  ctx.downloadFunc = downloadFormat;

  // run downloads with max CONCURRENCY in parallel
  const semaphore = createSemaphore(CONCURRENCY);

  await Promise.all(
    media.items.map((item, index) =>
      semaphore(async () => {
        const result = await downloadItem(ctx, item, index);
        results[index] = result;
      })
    )
  );

  const firstError = results.find(r => r?.error)?.error;
  if (firstError) throw firstError;

  return results;
}

async function downloadItem(ctx, item, index) {
  if (!item.formats.length) {
    return new DownloadedFormat({ index, error: new Error(`no formats for item ${index}`) });
  }

  const format = item.formats.length === 1 ? item.formats[0] : item.getDefaultFormat();
  if (!format) {
    return new DownloadedFormat({ index, error: new Error(`no default format for item ${index}`) });
  }

  logger.debug(`selected format: ${format.toString()}`);

  const validationErr = validateFormat(format);
  if (validationErr) return new DownloadedFormat({ index, error: validationErr });

  try {
    const downloaded = await downloadFormat(ctx, index, format);

    const postValidErr = validateFormat(format);
    if (postValidErr) return new DownloadedFormat({ index, error: postValidErr });

    await mergeFormats(ctx, item, downloaded);

    for (const plugin of (format.plugins || [])) {
      if (plugin?.runFunc) {
        try {
          await plugin.runFunc(ctx, item, downloaded);
        } catch (e) {
          return new DownloadedFormat({ index, error: new Error(`plugin ${plugin.id} failed: ${e.message}`) });
        }
      }
    }

    return downloaded;
  } catch (e) {
    return new DownloadedFormat({ index, error: e });
  }
}

export async function downloadFormat(ctx, index, format) {
  if (!format.url?.length) throw new Error('no URL for selected format');

  const fileName = format.getFileName();

  if (format.type === MediaType.Photo) {
    const buffer = await downloadFileInMemory(ctx, format.url, format.downloadSettings);
    const filePath = toPath(fileName);
    ctx.filesTracker.add(filePath);

    const bounds = await bufferToJpeg(buffer, filePath);
    format.width = bounds.w;
    format.height = bounds.h;

    return new DownloadedFormat({ format, index, filePath });
  }

  let filePath;
  if (format.segments?.length) {
    if (format.downloadSettings) format.downloadSettings.decryptionKey = format.decryptionKey;
    filePath = await downloadFileWithSegments(ctx, format.initSegment, format.segments, fileName, format.downloadSettings);
  } else {
    filePath = await downloadFile(ctx, format.url, fileName, format.downloadSettings);
  }

  const thumbnailFilePath = await getThumbnail(ctx, format, filePath);

  if (format.missingMetadata()) {
    const info = await getVideoInfo(filePath);
    format.width = info.width;
    format.height = info.height;
    format.duration = info.duration;
  }

  return new DownloadedFormat({ format, index, filePath, thumbnailFilePath });
}

async function mergeFormats(ctx, item, downloaded) {
  const format = downloaded.format;
  if (format.type !== MediaType.Video) return;

  const audioFormat = item.formats.find(f => f.type === MediaType.Audio && f !== format);
  if (!audioFormat) return;

  try {
    const { mergeAudioPlugin } = await import('../plugins/mergeAudio.js');
    await mergeAudioPlugin.runFunc(ctx, item, downloaded);
  } catch {}
}

function validateFormat(format) {
  if (format.fileSize && exceedsMaxFileSize(format.fileSize)) return Errors.FileTooLarge;
  if (format.duration && exceedsMaxDuration(format.duration)) return Errors.DurationTooLong;
  return null;
}

function createSemaphore(concurrency) {
  let running = 0;
  const queue = [];

  return function run(fn) {
    return new Promise((resolve, reject) => {
      const next = () => {
        if (running >= concurrency || !queue.length) return;
        running++;
        const { fn: f, resolve: res, reject: rej } = queue.shift();
        Promise.resolve()
          .then(() => f())
          .then(v => { running--; next(); res(v); })
          .catch(e => { running--; next(); rej(e); });
      };
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}
