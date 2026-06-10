import { Bot, GrammyError, HttpError, Context } from 'grammy';
import { Env } from '../config/index.js';
import logger from '../logger/index.js';

import { urlFilter, urlHandler } from './handlers/url.js';
import { startHandler, extractorsHandler } from './handlers/start.js';
import { settingsHandler, settingsOptionsHandler, settingsToggleHandler, settingsSelectHandler, settingsManyHandler } from './handlers/settings.js';
import { closeHandler, statsHandler, statsCallbackHandler, decodeErrorHandler, whitelistHandler, addedToGroupHandler, oldMessagesHandler } from './handlers/misc.js';

export function createBot(): Bot<Context> {
  if (!Env.BotToken) throw new Error('BOT_TOKEN is required');

  const botOpts: { client?: { apiRoot: string } } = {};
  if (Env.BotAPIURL && Env.BotAPIURL !== 'https://api.telegram.org') {
    botOpts.client = { apiRoot: Env.BotAPIURL };
  }

  const bot = new Bot<Context>(Env.BotToken, botOpts);
  return bot;
}

export function registerHandlers(bot: Bot<Context>): Bot<Context> {
  // whitelist guard
  if (Env.Whitelist.length > 0) {
    bot.use(async (ctx: Context, next: () => Promise<void>) => {
      const userId = ctx.from?.id;
      if (!userId) return next();
      if (Env.Whitelist.includes(userId) || Env.Admins.includes(userId)) return next();
      if (ctx.message) await ctx.reply("you're not whitelisted").catch(() => {});
      else if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "you're not whitelisted" }).catch(() => {});
    });
  }

  // commands
  bot.command('start', startHandler);
  bot.command('settings', settingsHandler);
  bot.command('stats', statsHandler);
  bot.command('derr', decodeErrorHandler);

  // callbacks
  bot.callbackQuery('start', startHandler);
  bot.callbackQuery('settings', settingsHandler);
  bot.callbackQuery('extractors', extractorsHandler);
  bot.callbackQuery('close', closeHandler);
  bot.callbackQuery(/^stats/, statsCallbackHandler);
  bot.callbackQuery(/^settings\.options/, settingsOptionsHandler);
  bot.callbackQuery(/^settings\.toggle/, settingsToggleHandler);
  bot.callbackQuery(/^settings\.select/, settingsSelectHandler);
  bot.callbackQuery(/^settings\.many/, settingsManyHandler);

  // group added
  bot.on('my_chat_member', addedToGroupHandler);

  // URL messages (text with url entity, not commands)
  bot.on('message', async (ctx: Context, next: () => Promise<void>) => {
    if (urlFilter(ctx)) {
      return urlHandler(ctx);
    }
    return next();
  });

  // catch old messages
  bot.on('message', oldMessagesHandler);

  bot.catch((err) => {
    const ctx = err.ctx;
    logger.error({ err: err.message }, `error handling update ${ctx?.update?.update_id}`);
    if (err.error instanceof GrammyError) {
      logger.error({ err: err.error.description }, 'grammy error');
    } else if (err.error instanceof HttpError) {
      logger.error({ err: err.error.message }, 'http error');
    } else {
      logger.error({ err: String(err.error) }, 'unknown error');
    }
  });

  return bot;
}

export async function startBot(): Promise<void> {
  const bot = createBot();
  registerHandlers(bot);

  logger.info('starting bot polling...');

  await bot.start({
    drop_pending_updates: true,
    allowed_updates: ['message', 'callback_query', 'inline_query', 'chosen_inline_result', 'my_chat_member'],
    onStart: (info) => {
      logger.info(`bot started: @${info.username}`);
    },
  });
}
