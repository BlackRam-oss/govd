import fs from 'fs';
import path from 'path';
import { InputFile } from 'grammy';
import { ChatType, MediaType } from '../database/index.js';
import { FileType, SendFormatsOptions } from '../models/index.js';
import { Errors, getMessageFileId, getMessageFileSize } from '../util/index.js';
import { Env } from '../config/index.js';
import { storeMedia } from './store.js';
import logger from '../logger/index.js';

export async function sendFormats(bot, ctx, extractorCtx, media, formats, options) {
  const chat = extractorCtx.chat;

  if (chat.type === ChatType.Group) {
    if (formats.length > chat.mediaAlbumLimit) throw Errors.MediaAlbumLimitExceeded;
    if (!chat.nsfw && media.nsfw) throw Errors.NSFWNotAllowed;
  }

  let chatId;
  let replyToMessageId;

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

  const sentMessages = [];
  const chunks = chunkArray(formats, 10);

  for (const chunk of chunks) {
    const mediaGroup = [];
    for (let i = 0; i < chunk.length; i++) {
      const df = chunk[i];
      const caption = i === 0 ? options.caption : undefined;
      const inputMedia = await buildInputMedia(df, caption, options.isSpoiler);
      mediaGroup.push(inputMedia);
    }

    const sendOpts = {};
    if (replyToMessageId) {
      sendOpts.reply_parameters = {
        message_id: replyToMessageId,
        allow_sending_without_reply: true,
      };
    }

    const msgs = await bot.api.sendMediaGroup(chatId, mediaGroup, sendOpts);
    sentMessages.push(...msgs);

    if (options.delete) {
      for (const m of msgs) {
        bot.api.deleteMessage(chatId, m.message_id).catch(() => {});
      }
    }
  }

  if (!sentMessages.length) throw new Error('no messages sent');

  if (chat.deleteLinks && ctx.message) {
    bot.api.deleteMessage(chatId, ctx.message.message_id).catch(() => {});
  }

  if (!options.isStored && Env.Caching) {
    try {
      await storeMedia(extractorCtx.extractor, media, sentMessages, formats);
    } catch (e) {
      logger.error({ err: e.message }, 'failed to cache media');
    }
  }

  return sentMessages;
}

export async function sendInlineFormats(bot, ctx, extractorCtx, media, formats, options) {
  const messages = await sendFormats(bot, ctx, extractorCtx, media, formats, {
    ...options,
    delete: true,
  });

  const msg = messages[0];
  const format = formats[0];
  const fileId = getMessageFileId(msg);
  format.format.fileId = fileId;

  const inputMedia = await buildInputMedia(format, options.caption, options.isSpoiler);

  await bot.api.editMessageMedia(
    undefined,
    undefined,
    inputMedia,
    { inline_message_id: ctx.chosenInlineResult?.inline_message_id }
  );
}

async function buildInputMedia(downloadedFormat, caption, isSpoiler) {
  const { format, filePath, thumbnailFilePath } = downloadedFormat;
  const [, fileType] = format.getInfo();

  let mediaFile;
  if (format.fileId) {
    mediaFile = format.fileId;
  } else {
    mediaFile = new InputFile(fs.createReadStream(filePath), path.basename(filePath));
  }

  let thumbnail;
  if (thumbnailFilePath && fs.existsSync(thumbnailFilePath)) {
    thumbnail = new InputFile(fs.createReadStream(thumbnailFilePath), path.basename(thumbnailFilePath));
  }

  const base = {
    caption: caption || undefined,
    parse_mode: 'HTML',
  };

  switch (fileType) {
    case FileType.Video:
      return {
        type: 'video',
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
        type: 'audio',
        media: mediaFile,
        thumbnail,
        duration: format.duration || undefined,
        performer: format.artist || undefined,
        title: format.title || undefined,
        ...base,
      };
    case FileType.Photo:
      return {
        type: 'photo',
        media: mediaFile,
        has_spoiler: isSpoiler || undefined,
        ...base,
      };
    case FileType.Document:
    default:
      return {
        type: 'document',
        media: mediaFile,
        thumbnail,
        ...base,
      };
  }
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}
