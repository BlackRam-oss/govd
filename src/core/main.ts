import { Env } from '../config/index.js';
import * as db from '../database/index.js';
import { ChatType } from '../database/index.js';
import { TaskResult, DownloadedFormat, Media, MediaItem, MediaFormat, ExtractorContext } from '../models/index.js';
import { Errors, BotError, hasHashtagEntity } from '../util/index.js';
import { acquireQueue, releaseQueue } from './queue.js';
import { downloadMediaFormats } from './download.js';
import { sendFormats } from './send.js';
import { ErrNoMedia } from './errors.js';
import logger from '../logger/index.js';
import { Bot, Context } from 'grammy';
import { ChatRow } from '../database/index.js';

export async function handleDownloadTask(bot: Bot<Context>, ctx: Context, extractorCtx: ExtractorContext): Promise<void> {
  const key = extractorCtx.key();
  await acquireQueue(key);
  try {
    const message = ctx.message;
    const isSpoiler = message
      ? hasHashtagEntity(message, 'spoiler') || hasHashtagEntity(message, 'nsfw')
      : false;

    const taskResult = await executeDownload(extractorCtx, false);

    const caption = formatCaption(taskResult.media, bot.botInfo?.username || '', extractorCtx.chat?.captions ?? false);

    await sendFormats(bot, ctx, extractorCtx, taskResult.media, taskResult.formats, {
      caption,
      isSpoiler,
      isStored: taskResult.isStored,
      delete: false,
    });
  } finally {
    releaseQueue(key);
    extractorCtx.filesTracker.cleanup();
  }
}

async function executeDownload(extractorCtx: ExtractorContext, isInline: boolean): Promise<TaskResult> {
  if (Env.Caching) {
    try {
      const task = await taskFromDatabase(extractorCtx);
      if (task) {
        if (isInline && task.media.items.length > 1) throw Errors.InlineMediaAlbum;
        checkAlbumLimit(task.media.items.length, extractorCtx.chat);
        logger.debug('media found in memory cache');
        return task;
      }
    } catch (e) {
      if (e instanceof BotError) throw e;
    }
  }

  const resp = await extractorCtx.extractor.getFunc(extractorCtx);
  if (!resp?.media || !resp.media.items.length) {
    logger.info({ extractor: extractorCtx.extractor.id, contentId: extractorCtx.contentId }, 'no media items found');
    throw ErrNoMedia;
  }

  logger.info({
    extractor: extractorCtx.extractor.id,
    contentId: extractorCtx.contentId,
    itemCount: resp.media.items.length,
    types: resp.media.items.map(i => i.formats[0]?.type),
  }, 'extractor returned items');

  if (isInline && resp.media.items.length > 1) throw Errors.InlineMediaAlbum;

  checkAlbumLimit(resp.media.items.length, extractorCtx.chat);

  const formats = await downloadMediaFormats(extractorCtx, resp.media);

  logger.info({
    extractor: extractorCtx.extractor.id,
    itemCount: formats.length,
    hasErrors: formats.some(f => f.error),
    errors: formats.filter(f => f.error).map(f => f.error?.message),
  }, 'download complete');

  return new TaskResult({ media: resp.media, formats });
}

async function taskFromDatabase(ctx: ExtractorContext): Promise<TaskResult | null> {
  const mediaRow = db.getMediaByContentID(ctx.contentId, ctx.extractor.id);
  if (!mediaRow) return null;

  const itemRows = db.getMediaItems(mediaRow.id);
  if (!itemRows.length) return null;

  const items = itemRows.map(row => {
    const fmt = db.getMediaFormat(row.id);
    const item = new MediaItem();
    if (fmt) {
      const mf = new MediaFormat();
      Object.assign(mf, {
        formatId: fmt.formatId || '',
        fileId: fmt.fileId || '',
        type: fmt.type,
        audioCodec: fmt.audioCodec || '',
        videoCodec: fmt.videoCodec || '',
        duration: fmt.duration || 0,
        fileSize: fmt.fileSize || 0,
        title: fmt.title || '',
        artist: fmt.artist || '',
        width: fmt.width || 0,
        height: fmt.height || 0,
        bitrate: fmt.bitrate || 0,
        url: [],
      });
      item.formats = [mf];
    }
    return item;
  });

  const media = new Media();
  media.contentId = mediaRow.contentId;
  media.contentUrl = mediaRow.contentUrl;
  media.caption = mediaRow.caption || '';
  media.nsfw = mediaRow.nsfw;
  media.extractorId = ctx.extractor.id;
  media.items = items;

  const formats = items.map((item, i) => new DownloadedFormat({ format: item.formats[0], index: i }));

  return new TaskResult({ media, formats, isStored: true });
}

function checkAlbumLimit(n: number, chat: ChatRow | null): void {
  if (chat?.type === ChatType.Group) {
    if (n > (chat.mediaAlbumLimit || 10)) throw Errors.MediaAlbumLimitExceeded;
  }
  if (n > 30) throw Errors.MediaAlbumGlobalLimitExceeded;
}

export function formatCaption(media: Media, username: string, captionsEnabled: boolean): string {
  if (!captionsEnabled) return '';

  const header = Env.CaptionsHeader
    .replace('{{url}}', media.contentUrl)
    .replace('{{username}}', username);

  const desc = media.caption
    ? Env.CaptionsDescription.replace('{{text}}', media.caption)
    : '';

  return [header, desc].filter(Boolean).join('\n');
}
