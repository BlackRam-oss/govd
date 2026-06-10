import { DownloadedFormat, ExtractorContext, MediaItem, MediaFormat } from '../models/index.js';
import { MediaType } from '../database/index.js';
import { exceedsMaxFileSize, exceedsMaxDuration, Errors } from '../util/index.js';
import { downloadBufferWithFetch } from '../util/download.js';
import logger from '../logger/index.js';

const CONCURRENCY = 3;

export async function downloadMediaFormats(ctx: ExtractorContext, media: { items: MediaItem[] }): Promise<DownloadedFormat[]> {
  const numItems = media.items.length;
  const results = new Array<DownloadedFormat>(numItems);

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

async function downloadItem(ctx: ExtractorContext, item: MediaItem, index: number): Promise<DownloadedFormat> {
  if (!item.formats.length) {
    return new DownloadedFormat({ index, error: new Error(`no formats for item ${index}`) });
  }

  const format = item.formats.length === 1 ? item.formats[0] : item.getDefaultFormat();
  if (!format) {
    return new DownloadedFormat({ index, error: new Error(`no default format for item ${index}`) });
  }

  // For photos with a public URL and no cached fileId, skip downloading.
  // Telegram fetches the URL directly, avoiding buffer memory and download time in the Worker.
  if (format.type === MediaType.Photo && format.url?.length && !format.fileId) {
    logger.info({ index, formatId: format.formatId, url: format.url[0]?.slice(0, 80) }, 'photo: using direct url, skipping download');
    return new DownloadedFormat({ format, index });
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
          return new DownloadedFormat({ index, error: new Error(`plugin ${plugin.id} failed: ${(e as Error).message}`) });
        }
      }
    }

    return downloaded;
  } catch (e) {
    return new DownloadedFormat({ index, error: e as Error });
  }
}

export async function downloadFormat(ctx: ExtractorContext, index: number, format: MediaFormat): Promise<DownloadedFormat> {
  if (!format.url?.length) throw new Error('no URL for selected format');

  const headers = format.downloadSettings?.headers || {};
  logger.info({ index, formatId: format.formatId, type: format.type, url: format.url[0]?.slice(0, 80) }, 'downloading format');

  const buffer = await downloadBufferWithFetch(format.url, headers);

  logger.info({ index, bytes: buffer.byteLength, formatId: format.formatId, type: format.type }, 'downloaded format');
  return new DownloadedFormat({ format, index, buffer });
}

async function mergeFormats(ctx: ExtractorContext, item: MediaItem, downloaded: DownloadedFormat): Promise<void> {
  const format = downloaded.format;
  if (format.type !== MediaType.Video) return;

  const audioFormat = item.formats.find(f => f.type === MediaType.Audio && f !== format);
  if (!audioFormat) return;

  try {
    const { mergeAudioPlugin } = await import('../plugins/mergeAudio.js');
    await mergeAudioPlugin.runFunc(ctx, item, downloaded);
  } catch {}
}

function validateFormat(format: MediaFormat): Error | null {
  if (format.fileSize && exceedsMaxFileSize(format.fileSize)) return Errors.FileTooLarge;
  if (format.duration && exceedsMaxDuration(format.duration)) return Errors.DurationTooLong;
  return null;
}

interface SemaphoreEntry {
  fn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

function createSemaphore(concurrency: number): (fn: () => Promise<unknown>) => Promise<unknown> {
  let running = 0;
  const queue: SemaphoreEntry[] = [];

  return function run(fn: () => Promise<unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const next = () => {
        if (running >= concurrency || !queue.length) return;
        running++;
        const { fn: f, resolve: res, reject: rej } = queue.shift()!;
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
