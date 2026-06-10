import { resolveURL } from '../../extractors/index.js';
import { handleDownloadTask } from '../../core/main.js';
import { handleError } from '../../core/errors.js';
import { urlFromMessage, hasHashtagEntity } from '../../util/index.js';
import { getOrCreateChat, ChatRow } from '../../database/index.js';
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

  const extractorCtx = await resolveURL(url);
  if (!extractorCtx) return;

  const chat = getChatFromCtx(ctx);
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
