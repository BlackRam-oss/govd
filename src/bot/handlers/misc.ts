import { Context } from 'grammy';
import { Env } from '../../config/index.js';
import * as db from '../../database/index.js';
import logger from '../../logger/index.js';

export async function closeHandler(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  try { await ctx.deleteMessage(); } catch {}
}

export async function statsHandler(ctx: Context): Promise<void> {
  const stats = db.getStats();
  const period = ctx.callbackQuery?.data?.replace('stats.', '') || 'all';

  const text = [
    '📊 <b>Statistics</b>',
    '',
    `👤 Private chats: <b>${stats.totalPrivateChats}</b>`,
    `👥 Group chats: <b>${stats.totalGroupChats}</b>`,
    `⬇️ Total downloads: <b>${stats.totalDownloads}</b>`,
    `💾 Total size: <b>${formatSize(stats.totalDownloadsSize)}</b>`,
  ].join('\n');

  const keyboard = {
    inline_keyboard: [[{ text: '❌ Close', callback_data: 'close' }]],
  };

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function statsCallbackHandler(ctx: Context): Promise<void> {
  return statsHandler(ctx);
}

export async function decodeErrorHandler(ctx: Context): Promise<void> {
  const text = ctx.message?.text || '';
  const parts = text.split(' ');
  const errorId = parts[1];
  if (!errorId) {
    await ctx.reply('Usage: /derr <error_id>');
    return;
  }
  await ctx.reply(`Error ID: <code>${errorId}</code>`, { parse_mode: 'HTML' });
}

export async function whitelistHandler(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  if (Env.Whitelist.includes(userId) || Env.Admins.includes(userId)) return;
  if (ctx.message) { await ctx.reply("you're not whitelisted"); }
  else if (ctx.callbackQuery) { await ctx.answerCallbackQuery({ text: "you're not whitelisted" }); }
  throw new Error('not whitelisted');
}

export async function addedToGroupHandler(ctx: Context): Promise<void> {
  const newStatus = ctx.myChatMember?.new_chat_member?.status;
  if (!newStatus || !['member', 'administrator'].includes(newStatus)) return;
  try {
    await ctx.reply('thank you for adding me! use /settings command to configure the bot for this group');
  } catch {}
}

export async function oldMessagesHandler(ctx: Context): Promise<void> {
  // ignore old messages
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 ** 2);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  if (kb >= 1) return `${kb.toFixed(0)} KB`;
  return `${bytes} B`;
}
