import { Context } from 'grammy';
import { t } from '../../localization/index.js';
import { Env } from '../../config/index.js';
import * as db from '../../database/index.js';
import { getChatFromCtx } from './url.js';
import { Extractors } from '../../extractors/index.js';
import type { ChatRow } from '../../database/index.js';

interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

interface InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][];
}

export async function settingsHandler(ctx: Context): Promise<void> {
  const chat = getChatFromCtx(ctx);
  const lang = chat?.language || Env.DefaultLanguage;
  const isGroup = ctx.chat?.type !== 'private';

  const text = t(isGroup ? 'GroupSettingsMessage' : 'PrivateSettingsMessage', lang);
  const keyboard = buildSettingsKeyboard(chat!, lang, isGroup);

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } else {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

export async function settingsOptionsHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data || '';
  const option = data.replace('settings.options.', '');
  const chat = getChatFromCtx(ctx);
  const lang = chat?.language || Env.DefaultLanguage;

  await ctx.answerCallbackQuery();

  switch (option) {
    case 'language': {
      const keyboard = buildLanguageKeyboard(lang);
      await ctx.editMessageText(t('SelectLanguageMessage', lang), { reply_markup: keyboard });
      break;
    }
    case 'captions': {
      const keyboard = buildToggleKeyboard('captions', chat?.captions ?? false, lang);
      await ctx.editMessageText(t('CaptionsSettingsMessage', lang), { reply_markup: keyboard });
      break;
    }
    case 'nsfw': {
      const keyboard = buildToggleKeyboard('nsfw', chat?.nsfw ?? false, lang);
      await ctx.editMessageText(t('NsfwSettingsMessage', lang), { reply_markup: keyboard });
      break;
    }
    case 'silent': {
      const keyboard = buildToggleKeyboard('silent', chat?.silent ?? false, lang);
      await ctx.editMessageText(t('SilentModeSettingsMessage', lang), { reply_markup: keyboard });
      break;
    }
    case 'media_album': {
      const keyboard = buildAlbumKeyboard(chat?.mediaAlbumLimit ?? 10, lang);
      await ctx.editMessageText(t('MediaAlbumSettingsMessage', lang), { reply_markup: keyboard });
      break;
    }
    case 'extractors': {
      const keyboard = buildExtractorsKeyboard(chat!, lang);
      await ctx.editMessageText(t('DisabledExtractorsSettingsMessage', lang), { reply_markup: keyboard });
      break;
    }
  }
}

export async function settingsToggleHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data || '';
  const option = data.replace('settings.toggle.', '');
  const chat = getChatFromCtx(ctx);
  const chatId = ctx.chat?.id;

  await ctx.answerCallbackQuery();

  if (chatId !== undefined) {
    switch (option) {
      case 'captions': db.toggleChatCaptions(chatId); break;
      case 'nsfw': db.toggleChatNsfw(chatId); break;
      case 'silent': db.toggleChatSilentMode(chatId); break;
    }
  }

  await settingsHandler(ctx);
}

export async function settingsSelectHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data || '';
  const parts = data.replace('settings.select.', '').split('.');
  const option = parts[0];
  const value = parts.slice(1).join('.');
  const chatId = ctx.chat?.id;

  await ctx.answerCallbackQuery();

  if (chatId !== undefined) {
    switch (option) {
      case 'language': db.setChatLanguage(chatId, value); break;
      case 'extractor_toggle': {
        const chat = getChatFromCtx(ctx);
        if (chat?.disabledExtractors?.includes(value)) {
          db.removeDisabledExtractor(chatId, value);
        } else {
          db.addDisabledExtractor(chatId, value);
        }
        break;
      }
    }
  }

  await settingsHandler(ctx);
}

export async function settingsManyHandler(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data || '';
  const parts = data.replace('settings.many.', '').split('.');
  const option = parts[0];
  const value = parseInt(parts[1]);
  const chatId = ctx.chat?.id;

  await ctx.answerCallbackQuery();

  if (option === 'media_album' && chatId !== undefined) {
    db.setChatMediaAlbumLimit(chatId, value);
  }

  await settingsHandler(ctx);
}

// ── keyboard builders ─────────────────────────────────────────────────────────

function buildSettingsKeyboard(chat: ChatRow, lang: string, isGroup: boolean): InlineKeyboard {
  const onOff = (v: boolean): string => (v ? `✅ ${t('EnabledButton', lang)}` : `❌ ${t('DisabledButton', lang)}`);
  const rows: InlineKeyboardButton[][] = [
    [{ text: `🌐 ${t('LanguageButton', lang)} → ${chat.language}`, callback_data: 'settings.options.language' }],
    [{ text: `💬 ${t('CaptionsButton', lang)} ${onOff(chat.captions)}`, callback_data: 'settings.options.captions' }],
    [{ text: `🔇 ${t('SilentModeButton', lang)} ${onOff(chat.silent)}`, callback_data: 'settings.options.silent' }],
  ];

  if (isGroup) {
    rows.push([{ text: `🔞 ${t('NsfwButton', lang)} ${onOff(chat.nsfw)}`, callback_data: 'settings.options.nsfw' }]);
    rows.push([{ text: `📸 ${t('MediaAlbumButton', lang)} → ${chat.mediaAlbumLimit}`, callback_data: 'settings.options.media_album' }]);
    rows.push([{ text: `🔌 ${t('ExtractorsButton', lang)}`, callback_data: 'settings.options.extractors' }]);
  }

  rows.push([{ text: `❌ ${t('CloseButton', lang)}`, callback_data: 'close' }]);

  return { inline_keyboard: rows };
}

function buildLanguageKeyboard(lang: string): InlineKeyboard {
  const langs: [string, string][] = [
    ['en', '🇬🇧 English'], ['it', '🇮🇹 Italiano'], ['de', '🇩🇪 Deutsch'],
    ['es', '🇪🇸 Español'], ['fr', '🇫🇷 Français'], ['pt', '🇧🇷 Português'],
    ['ru', '🇷🇺 Русский'], ['zh', '🇨🇳 中文'], ['ar', '🇸🇦 العربية'],
    ['ja', '🇯🇵 日本語'], ['ko', '🇰🇷 한국어'],
  ];
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < langs.length; i += 2) {
    const row = langs.slice(i, i + 2).map(([code, label]) => ({
      text: label,
      callback_data: `settings.select.language.${code}`,
    }));
    rows.push(row);
  }
  rows.push([{ text: t('BackButton', lang), callback_data: 'settings' }]);
  return { inline_keyboard: rows };
}

function buildToggleKeyboard(option: string, current: boolean, lang: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: current ? `❌ ${t('DisabledButton', lang)}` : `✅ ${t('EnabledButton', lang)}`, callback_data: `settings.toggle.${option}` }],
      [{ text: t('BackButton', lang), callback_data: 'settings' }],
    ],
  };
}

function buildAlbumKeyboard(current: number, lang: string): InlineKeyboard {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20];
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < values.length; i += 4) {
    rows.push(values.slice(i, i + 4).map(v => ({
      text: v === current ? `[${v}]` : `${v}`,
      callback_data: `settings.many.media_album.${v}`,
    })));
  }
  rows.push([{ text: t('BackButton', lang), callback_data: 'settings' }]);
  return { inline_keyboard: rows };
}

function buildExtractorsKeyboard(chat: ChatRow, lang: string): InlineKeyboard {
  const visible = Extractors.filter(e => !e.hidden);
  const seen = new Set<string>();
  const unique = visible.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });

  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < unique.length; i += 2) {
    rows.push(unique.slice(i, i + 2).map(e => ({
      text: `${chat.disabledExtractors?.includes(e.id) ? '❌' : '✅'} ${e.displayName}`,
      callback_data: `settings.select.extractor_toggle.${e.id}`,
    })));
  }
  rows.push([{ text: t('BackButton', lang), callback_data: 'settings' }]);
  return { inline_keyboard: rows };
}
