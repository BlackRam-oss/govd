type LocalizedString = {
  en: string;
  it?: string;
};

type Messages = {
  [key: string]: LocalizedString;
};

export const messages: Messages = {
  Language: { en: 'english', it: 'italian' },
  StartMessage: {
    en: 'welcome {{Name}} to govd, an open-source telegram bot for downloading content from various social platforms',
  },
  AddButton: { en: 'add to a group' },
  ErrorMessage: { en: 'an error occurred, please try again later' },
  AddedToGroupMessage: {
    en: 'thank you for adding me! use /settings command to configure the bot for this group',
  },
  SettingsButton: { en: 'settings' },
  LanguageButton: { en: 'language' },
  PrivateSettingsMessage: { en: 'use the buttons below to change your personal bot settings' },
  GroupSettingsMessage: { en: "use the buttons below to change this group's bot settings" },
  BackButton: { en: 'back' },
  SelectLanguageMessage: { en: 'select your preferred language' },
  CaptionsSettingsMessage: {
    en: 'when enabled, adds original description to downloaded content, if available',
  },
  NsfwSettingsMessage: { en: 'when enabled, allows downloading nsfw content in this chat' },
  SilentModeSettingsMessage: {
    en: 'when enabled, the bot will not send error messages',
  },
  MediaAlbumSettingsMessage: {
    en: 'select maximum number of files allowed in a single media album',
  },
  InlineLoadingMessage: { en: 'loading... please wait' },
  InlineShareMessage: { en: 'share this media' },
  NoPermission: { en: "you don't have permissions to perform this action" },
  CloseButton: { en: 'close' },
  MediaAlbumButton: { en: 'media album' },
  SilentModeButton: { en: 'silent mode' },
  CaptionsButton: { en: 'captions' },
  NsfwButton: { en: 'nsfw' },
  ExtractorsButton: { en: 'extractors' },
  DisabledExtractorsSettingsMessage: {
    en: 'select which extractors should be disabled',
  },
  DeleteLinksButton: { en: 'links' },
  DeleteLinksSettingsMessage: {
    en: 'when enabled, deletes the original message after processing the link',
  },
  SupportedExtractorsMessage: { en: 'list of supported extractors by the bot' },
  EnabledButton: { en: 'enabled' },
  DisabledButton: { en: 'disabled' },
};

export function t(messageId: string, lang: string = 'en', data: Record<string, string> = {}): string {
  const msg = messages[messageId];
  if (!msg) return messageId;
  const template = msg[lang as keyof LocalizedString] || msg['en'] || messageId;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => data[key] || `{{${key}}}`);
}

export function localizer(lang: string = 'en'): { t: (messageId: string, data?: Record<string, string>) => string } {
  return {
    t: (messageId: string, data: Record<string, string> = {}) => t(messageId, lang, data),
  };
}
