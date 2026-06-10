import { BotError, hashedError, Errors } from '../util/index.js';
import * as db from '../database/index.js';
import logger from '../logger/index.js';
import { Bot, Context } from 'grammy';
import { ExtractorContext } from '../models/index.js';

export const ErrNoMedia = new Error('no media found');

export function handleError(bot: Bot<Context>, ctx: Context, extractorCtx: ExtractorContext, err: unknown): void {
  const chat = extractorCtx.chat;
  const lang = chat?.language || 'en';

  if (err instanceof BotError) {
    sendErrorMessage(bot, ctx, '', localizeError(err.id, lang));
    return;
  }

  if (err === ErrNoMedia || (err instanceof Error && err.message === ErrNoMedia.message)) return;

  if (isChatWriteForbidden(err)) return;
  if (isPermissionDenied(err)) {
    sendErrorMessage(bot, ctx, '', localizeError('ErrorPermissionDenied', lang));
    return;
  }

  const errorId = hashedError(err as Error);
  logger.error({ err: (err as Error).message, errorId }, 'unexpected error');

  sendErrorMessage(bot, ctx, errorId, localizeError('ErrorMessage', lang));

  db.logError(errorId, (err as Error).message);
}

function isChatWriteForbidden(err: unknown): boolean {
  return (err as Error)?.message?.includes('CHAT_WRITE_FORBIDDEN') ?? false;
}

function isPermissionDenied(err: unknown): boolean {
  return (err as Error)?.message?.includes('not enough rights') ?? false;
}

function formatErrorMessage(ctx: Context, message: string, errorId: string): string {
  const suffix = errorId
    ? (ctx.callbackQuery || ctx.inlineQuery ? ` [${errorId}]` : ` [<code>${errorId}</code>]`)
    : '';
  return `⚠️ ${message}${suffix}`;
}

function sendErrorMessage(bot: Bot<Context>, ctx: Context, errorId: string, message: string): void {
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
    const inlineId = ctx.chosenInlineResult.inline_message_id;
    if (inlineId) {
      bot.api.editMessageTextInline(inlineId, text, {
        link_preview_options: { is_disabled: true },
      }).catch(() => {});
    }
  }
}

const errorMessages: Record<string, string> = {
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

function localizeError(id: string, lang: string): string {
  return errorMessages[id] || errorMessages.ErrorMessage;
}
