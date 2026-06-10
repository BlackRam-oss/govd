import { Env } from '../../config/index.js';
import { t } from '../../localization/index.js';
import { mentionUser } from '../../util/index.js';
import { getChatFromCtx } from './url.js';

export async function startHandler(ctx) {
  const tgChat = ctx.chat;
  if (!tgChat) return;

  if (tgChat.type !== 'private') {
    await ctx.reply('✅');
    return;
  }

  const chat = getChatFromCtx(ctx);
  const lang = chat?.language || Env.DefaultLanguage;
  const user = ctx.from;

  const name = mentionUser(user);
  const text = t('StartMessage', lang, { Name: name });

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: t('AddButton', lang),
          url: `https://t.me/${ctx.me?.username}?startgroup=true`,
        },
      ],
      [
        { text: t('SettingsButton', lang), callback_data: 'settings' },
        { text: t('ExtractorsButton', lang), callback_data: 'extractors' },
      ],
      [
        { text: 'github', url: Env.RepoURL },
      ],
    ],
  };

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }
}

export async function extractorsHandler(ctx) {
  const chat = getChatFromCtx(ctx);
  const lang = chat?.language || Env.DefaultLanguage;

  const { Extractors } = await import('../../extractors/index.js');
  const visible = Extractors.filter(e => !e.hidden);

  const lines = visible.map(e => `• ${e.displayName}`).join('\n');
  const text = `${t('SupportedExtractorsMessage', lang)}\n\n${lines}`;

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text, {
      reply_markup: {
        inline_keyboard: [[{ text: t('BackButton', lang), callback_data: 'start' }]],
      },
    });
  } else {
    await ctx.reply(text);
  }
}
