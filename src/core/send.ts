import fs from 'fs';
import path from 'path';
import { InputFile } from 'grammy';
import type { Bot, Context } from 'grammy';
import type { Message } from '@grammyjs/types';
import { ChatType, MediaType } from '../database/index.js';
import { FileType, SendFormatsOptions } from '../models/index.js';
import type { DownloadedFormat, Media, ExtractorContext } from '../models/index.js';
import { Errors, getMessageFileId, getMessageFileSize } from '../util/index.js';
import { Env } from '../config/index.js';
import { storeMedia } from './store.js';
import logger from '../logger/index.js';

export async function sendFormats(
  bot: Bot<Context>,
  ctx: Context,
  extractorCtx: ExtractorContext,
  media: Media,
  formats: DownloadedFormat[],
  options: SendFormatsOptions,
): Promise<Message[]> {
  const chat = extractorCtx.chat;

  if (chat && chat.type === ChatType.Group) {
    if (formats.length > chat.mediaAlbumLimit) throw Errors.MediaAlbumLimitExceeded;
    if (!chat.nsfw && media.nsfw) throw Errors.NSFWNotAllowed;
  }

  let chatId: number | undefined;
  let replyToMessageId: number | undefined;

  if (ctx.message) {
    chatId = ctx.message.chat.id;
    replyToMessageId = ctx.message.message_id;
  } else if (ctx.callbackQuery) {
    chatId = ctx.callbackQuery.message?.chat.id;
  } else if (ctx.inlineQuery) {
    chatId = ctx.inlineQuery.from.id;
  } else if (ctx.chosenInlineResult) {
    chatId = ctx.chosenInlineResult.from.id;
  } else {
    throw new Error('failed to get chat id');
  }

  const sentMessages: Message[] = [];
  const chunks = chunkArray(formats, 10);

  for (const chunk of chunks) {
    const mediaGroup: object[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const df = chunk[i];
      const caption = i === 0 ? options.caption : undefined;
      const inputMedia = await buildInputMedia(df, caption, options.isSpoiler);
      mediaGroup.push(inputMedia);
    }

    const sendOpts: Record<string, unknown> = {};
    if (replyToMessageId) {
      sendOpts.reply_parameters = {
        message_id: replyToMessageId,
        allow_sending_without_reply: true,
      };
    }

    const msgs = await bot.api.sendMediaGroup(chatId!, mediaGroup as any, sendOpts as any);
    sentMessages.push(...msgs);

    if (options.delete) {
      for (const m of msgs) {
        bot.api.deleteMessage(chatId!, m.message_id).catch((err: Error) => {
          logger.warn({ err: err.message }, 'failed to delete sent message');
        });
      }
    }
  }

  if (!sentMessages.length) throw new Error('no messages sent');

  if (ctx.message) {
    bot.api.deleteMessage(chatId!, ctx.message.message_id).catch((err: Error) => {
      logger.warn({ chatId, err: err.message }, 'failed to delete link message');
    });
  }

  if (!options.isStored && Env.Caching) {
    try {
      await storeMedia(extractorCtx.extractor, media, sentMessages, formats);
    } catch (e: unknown) {
      const err = e as Error;
      logger.error({ err: err.message }, 'failed to cache media');
    }
  }

  return sentMessages;
}

export async function sendInlineFormats(
  bot: Bot<Context>,
  ctx: Context,
  extractorCtx: ExtractorContext,
  media: Media,
  formats: DownloadedFormat[],
  options: SendFormatsOptions,
): Promise<void> {
  const messages = await sendFormats(bot, ctx, extractorCtx, media, formats, {
    ...options,
    delete: true,
  });

  const msg = messages[0];
  const format = formats[0];
  const fileId = getMessageFileId(msg);
  format.format.fileId = fileId;

  const inputMedia = await buildInputMedia(format, options.caption, options.isSpoiler);

  const inlineId = ctx.chosenInlineResult?.inline_message_id;
  if (inlineId) {
    await bot.api.editMessageMediaInline(inlineId, inputMedia as any);
  }
}

async function buildInputMedia(
  downloadedFormat: DownloadedFormat,
  caption: string | undefined,
  isSpoiler: boolean,
): Promise<object> {
  const { format, filePath, thumbnailFilePath, buffer } = downloadedFormat;
  const [ext, fileType] = format.getInfo();

  let mediaFile: string | InputFile;
  if (format.fileId) {
    mediaFile = format.fileId;
  } else if (buffer) {
    mediaFile = new InputFile(buffer, `media.${ext}`);
  } else {
    mediaFile = new InputFile(fs.createReadStream(filePath), path.basename(filePath));
  }

  let thumbnail: InputFile | undefined;
  if (!buffer && thumbnailFilePath) {
    try {
      if (fs.existsSync(thumbnailFilePath)) {
        thumbnail = new InputFile(fs.createReadStream(thumbnailFilePath), path.basename(thumbnailFilePath));
      }
    } catch (_) {}
  }

  const base = {
    caption: caption || undefined,
    parse_mode: 'HTML' as const,
  };

  switch (fileType) {
    case FileType.Video:
      return {
        type: 'video' as const,
        media: mediaFile,
        thumbnail,
        width: format.width || undefined,
        height: format.height || undefined,
        duration: format.duration || undefined,
        supports_streaming: true,
        has_spoiler: isSpoiler || undefined,
        ...base,
      };
    case FileType.Audio:
      return {
        type: 'audio' as const,
        media: mediaFile,
        thumbnail,
        duration: format.duration || undefined,
        performer: format.artist || undefined,
        title: format.title || undefined,
        ...base,
      };
    case FileType.Photo:
      return {
        type: 'photo' as const,
        media: mediaFile,
        has_spoiler: isSpoiler || undefined,
        ...base,
      };
    case FileType.Document:
    default:
      return {
        type: 'document' as const,
        media: mediaFile,
        thumbnail,
        ...base,
      };
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}
