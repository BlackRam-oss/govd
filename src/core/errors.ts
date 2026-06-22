import { BotError, hashedError, Errors } from '../util/index.js';
import * as db from '../database/index.js';
import logger from '../logger/index.js';
import { Bot, Context } from 'grammy';
import { ExtractorContext } from '../models/index.js';
import { t } from '../localization/index.js';

export const ErrNoMedia = new Error('no media found');

type AltSite = { label: string; url: string };

const altSiteMap: Record<string, Record<string, AltSite[]>> = {
  tiktok: {
    ErrorGeoRestrictedContent: [{ label: 'snaptik.app', url: 'https://snaptik.app' }],
    ErrorAgeRestricted:        [{ label: 'snaptik.app', url: 'https://snaptik.app' }],
  },
  youtube: {
    ErrorAgeRestricted: [{ label: 'yewtu.be', url: 'https://yewtu.be' }],
  },
};

export async function handleError(bot: Bot<Context>, ctx: Context, extractorCtx: ExtractorContext, err: unknown): Promise<void> {
  const chat = extractorCtx.chat;
  const lang = chat?.language || 'en';

  if (err instanceof BotError) {
    logger.info({ errorId: err.id, extractor: extractorCtx.extractor.id, contentId: extractorCtx.contentId }, 'bot error');
    const altSites = altSiteMap[extractorCtx.extractor.id]?.[err.id] ?? [];
    await sendErrorMessage(bot, ctx, '', localizeError(err.id, lang), undefined, altSites);
    return;
  }

  if (err === ErrNoMedia || (err instanceof Error && err.message === ErrNoMedia.message)) {
    logger.debug({ extractor: extractorCtx.extractor.id, contentId: extractorCtx.contentId }, 'no media found');
    return;
  }

  if (isChatWriteForbidden(err)) return;
  if (isPermissionDenied(err)) {
    await sendErrorMessage(bot, ctx, '', localizeError('ErrorPermissionDenied', lang));
    return;
  }

  const errorId = hashedError(err as Error);
  const errMsg = (err as Error).message || String(err);
  logger.error({ err: errMsg, errorId, extractor: extractorCtx.extractor.id, contentId: extractorCtx.contentId }, 'unexpected error');

  await sendErrorMessage(bot, ctx, errorId, localizeError('ErrorMessage', lang), errMsg);

  db.logError(errorId, (err as Error).message);
}

function isChatWriteForbidden(err: unknown): boolean {
  return (err as Error)?.message?.includes('CHAT_WRITE_FORBIDDEN') ?? false;
}

function isPermissionDenied(err: unknown): boolean {
  return (err as Error)?.message?.includes('not enough rights') ?? false;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatErrorMessage(ctx: Context, message: string, errorId: string, detail?: string): string {
  const suffix = errorId
    ? (ctx.callbackQuery || ctx.inlineQuery ? ` [${errorId}]` : ` [<code>${errorId}</code>]`)
    : '';
  const detailPart = detail ? `\n<code>${escapeHtml(detail)}</code>` : '';
  return `⚠️ ${message}${suffix}${detailPart}`;
}

async function sendErrorMessage(bot: Bot<Context>, ctx: Context, errorId: string, message: string, detail?: string, altSites: AltSite[] = []): Promise<void> {
  try {
    const text = formatErrorMessage(ctx, message, errorId, detail);
    const replyMarkup = altSites.length > 0
      ? { inline_keyboard: [altSites.map(s => ({ text: s.label, url: s.url }))] }
      : undefined;

    if (ctx.message) {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
        reply_markup: replyMarkup,
      });
    } else if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text, show_alert: true });
    } else if (ctx.inlineQuery) {
      await ctx.answerInlineQuery([], {
        cache_time: 0,
        button: { text, start_parameter: 'start' },
      });
    } else if (ctx.chosenInlineResult) {
      const inlineId = ctx.chosenInlineResult.inline_message_id;
      if (inlineId) {
        await bot.api.editMessageTextInline(inlineId, text, {
          link_preview_options: { is_disabled: true },
        });
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'failed to send error message');
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
  try {
    const localized = t(id, lang);
    if (localized !== id) return localized;
  } catch {
    // i18next not ready — fall through to static messages
  }
  return errorMessages[id] || errorMessages.ErrorMessage;
}
