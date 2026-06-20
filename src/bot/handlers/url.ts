import { resolveURL } from '../../extractors/index.js';
import { handleDownloadTask } from '../../core/main.js';
import { handleError } from '../../core/errors.js';
import { urlFromMessage, hasHashtagEntity, BotError, hashedError } from '../../util/index.js';
import { getOrCreateChat, ChatRow } from '../../database/index.js';
import * as db from '../../database/index.js';
import { Env } from '../../config/index.js';
import logger from '../../logger/index.js';
import { Context } from 'grammy';

export function urlFilter(ctx: Context): boolean {
  if (!ctx.message?.text) return false;
  if (ctx.message.text.startsWith('/')) return false;
  const entities = ctx.message.entities || [];
  return entities.some(e => e.type === 'url' || e.type === 'text_link');
}

export async function urlHandler(ctx: Context): Promise<void> {
  const message = ctx.message;
  const url = urlFromMessage(message as any);
  if (!url) return;

  if (hasHashtagEntity(message as any, 'skip')) return;

  const chat = getChatFromCtx(ctx);

  let extractorCtx;
  try {
    extractorCtx = await resolveURL(url);
  } catch (e) {
    sendResolutionError(ctx, e, chat?.language || Env.DefaultLanguage);
    return;
  }

  if (!extractorCtx) return;

  if (chat && chat.disabledExtractors?.includes(extractorCtx.extractor.id)) return;

  extractorCtx.setChat(chat);

  try {
    await ctx.replyWithChatAction('typing');
  } catch {}

  try {
    await handleDownloadTask((ctx.api ? { api: ctx.api, botInfo: ctx.me } : ctx) as any, ctx, extractorCtx);
  } catch (e) {
    handleError(ctx as any, ctx, extractorCtx, e);
  }
}

function sendResolutionError(ctx: Context, e: unknown, lang: string): void {
  if (!ctx.message) return;

  let text: string;
  if (e instanceof BotError) {
    text = `⚠️ ${localizeResolutionError(e.id)}`;
    logger.info({ errorId: e.id }, 'resolution bot error');
  } else {
    const errorId = hashedError(e as Error);
    const errMsg = ((e as Error).message || String(e)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    logger.error({ err: (e as Error).message, errorId }, 'url resolution failed');
    db.logError(errorId, (e as Error).message);
    text = `⚠️ failed to resolve url [<code>${errorId}</code>]\n<code>${errMsg}</code>`;
  }

  ctx.reply(text, {
    parse_mode: 'HTML',
    reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
  }).catch((err: Error) => {
    logger.warn({ err: err.message }, 'failed to send resolution error reply');
  });
}

const resolutionErrors: Record<string, string> = {
  ErrorGeoRestrictedContent: 'this content has geo-restrictions',
  ErrorUnavailable: 'this content is unavailable',
  ErrorAuthenticationNeeded: 'this instance is not authenticated with this service',
};

function localizeResolutionError(id: string): string {
  return resolutionErrors[id] || 'failed to resolve url';
}

export function getChatFromCtx(ctx: Context): ChatRow | null {
  const tgChat = ctx.chat;
  if (!tgChat) return null;

  const user = ctx.from;
  const isGroup = tgChat.type === 'group' || tgChat.type === 'supergroup';
  const lang = user?.language_code?.slice(0, 2) || Env.DefaultLanguage;

  return getOrCreateChat(
    tgChat.id,
    isGroup ? 'group' : 'private',
    Env.AutomaticLanguageDetection ? lang : Env.DefaultLanguage,
    Env.DefaultCaptions,
    Env.DefaultSilent,
    Env.DefaultNSFW,
    Env.DefaultMediaAlbumLimit,
  );
}
