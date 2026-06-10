import { BotError, hashedError, Errors } from '../util/index.js';
import * as db from '../database/index.js';
import logger from '../logger/index.js';

export const ErrNoMedia = new Error('no media found');

export function handleError(bot, ctx, extractorCtx, err) {
  const chat = extractorCtx.chat;
  const lang = chat?.language || 'en';

  if (err instanceof BotError) {
    sendErrorMessage(bot, ctx, '', localizeError(err.id, lang));
    return;
  }

  if (err === ErrNoMedia || err?.message === ErrNoMedia.message) return;

  if (isChatWriteForbidden(err)) return;
  if (isPermissionDenied(err)) {
    sendErrorMessage(bot, ctx, '', localizeError('ErrorPermissionDenied', lang));
    return;
  }

  const errorId = hashedError(err);
  logger.error({ err: err.message, errorId }, 'unexpected error');

  sendErrorMessage(bot, ctx, errorId, localizeError('ErrorMessage', lang));

  db.logError(errorId, err.message);
}

function isChatWriteForbidden(err) {
  return err?.message?.includes('CHAT_WRITE_FORBIDDEN');
}

function isPermissionDenied(err) {
  return err?.message?.includes('not enough rights');
}

function formatErrorMessage(ctx, message, errorId) {
  const suffix = errorId
    ? (ctx.callbackQuery || ctx.inlineQuery ? ` [${errorId}]` : ` [<code>${errorId}</code>]`)
    : '';
  return `⚠️ ${message}${suffix}`;
}

function sendErrorMessage(bot, ctx, errorId, message) {
  const text = formatErrorMessage(ctx, message, errorId);

  if (ctx.message) {
    ctx.reply(text, { parse_mode: 'HTML' }).catch(() => {});
  } else if (ctx.callbackQuery) {
    ctx.answerCallbackQuery({ text, show_alert: true }).catch(() => {});
  } else if (ctx.inlineQuery) {
    ctx.answerInlineQuery([], {
      cache_time: 0,
      button: { text, start_parameter: 'start' },
    }).catch(() => {});
  } else if (ctx.chosenInlineResult) {
    bot.api.editMessageText(text, {
      inline_message_id: ctx.chosenInlineResult.inline_message_id,
      link_preview_options: { is_disabled: true },
    }).catch(() => {});
  }
}

const errorMessages = {
  ErrorUnavailable: 'this content is unavailable',
  ErrorTimeout: 'timeout error when downloading. try again later',
  ErrorUnsupportedImageFormat: 'unsupported image format',
  ErrorMediaAlbumLimitExceeded: 'media album limit exceeds the maximum allowed for this group',
  ErrorMediaAlbumGlobalLimitExceeded: 'media album limit exceeds the maximum allowed for this instance',
  ErrorGeoRestrictedContent: 'this content has geo-restrictions',
  ErrorNSFWNotAllowed: 'this content is nsfw and cannot be downloaded here',
  ErrorInlineMediaAlbum: 'media albums not supported in inline mode',
  ErrorAuthenticationNeeded: 'this instance is not authenticated with this service',
  ErrorFileTooLarge: 'this file is too large',
  ErrorTelegramFileTooLarge: 'this file is too large for telegram',
  ErrorDurationTooLong: 'this video is too long',
  ErrorPaidContent: 'this content requires a subscription',
  ErrorAgeRestricted: 'this content is age-restricted',
  ErrorPermissionDenied: 'the bot lacks permissions to send media here',
  ErrorMessage: 'an error occurred, please try again later',
};

function localizeError(id, lang) {
  return errorMessages[id] || errorMessages.ErrorMessage;
}
