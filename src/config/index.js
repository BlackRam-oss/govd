import { config } from 'dotenv';
import path from 'path';

config();

function parseIntEnv(key, defaultVal) {
  const val = process.env[key];
  if (!val) return defaultVal;
  const n = parseInt(val, 10);
  return isNaN(n) ? defaultVal : n;
}

function parseBoolEnv(key, defaultVal) {
  const val = process.env[key];
  if (!val) return defaultVal;
  return val.toLowerCase() === 'true' || val === '1';
}

function parseListEnv(key) {
  const val = process.env[key];
  if (!val || val.trim() === '') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(n => !isNaN(n));
}

function parseStringListEnv(key) {
  const val = process.env[key];
  if (!val || val.trim() === '') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

export const Env = {
  DBHost: process.env.DB_HOST || '',
  DBPort: parseIntEnv('DB_PORT', 5432),
  DBName: process.env.DB_NAME || '',
  DBUser: process.env.DB_USER || '',
  DBPassword: process.env.DB_PASSWORD || '',

  BotToken: process.env.BOT_TOKEN || '',
  BotAPIURL: process.env.BOT_API_URL || 'https://api.telegram.org',
  ConcurrentUpdates: parseIntEnv('CONCURRENT_UPDATES', 50),

  DownloadsDirectory: process.env.DOWNLOADS_DIR || 'downloads',

  Proxy: process.env.PROXY || '',

  MaxDuration: parseIntEnv('MAX_DURATION', 3600),
  MaxFileSize: parseIntEnv('MAX_FILE_SIZE', 1000) * 1024 * 1024,
  RepoURL: process.env.REPO_URL || 'https://github.com/govdbot/govd',
  LogLevel: process.env.LOG_LEVEL || 'info',

  Whitelist: parseListEnv('WHITELIST'),
  Admins: parseListEnv('ADMINS'),

  Caching: parseBoolEnv('CACHING', true),

  CaptionsHeader: process.env.CAPTIONS_HEADER || "<a href='{{url}}'>source</a> - @{{username}}",
  CaptionsDescription: process.env.CAPTIONS_DESCRIPTION || '<blockquote>{{text}}</blockquote>',

  DefaultCaptions: parseBoolEnv('DEFAULT_ENABLE_CAPTIONS', true),
  DefaultSilent: parseBoolEnv('DEFAULT_ENABLE_SILENT', false),
  DefaultNSFW: parseBoolEnv('DEFAULT_ENABLE_NSFW', false),
  DefaultMediaAlbumLimit: parseIntEnv('DEFAULT_MEDIA_ALBUM_LIMIT', 10),
  DefaultLanguage: process.env.DEFAULT_LANGUAGE || 'en',
  DefaultDeleteLinks: parseBoolEnv('DEFAULT_DELETE_LINKS', false),

  AutomaticLanguageDetection: parseBoolEnv('AUTOMATIC_LANGUAGE_DETECTION', true),

  DownloadsDir: path.resolve(process.env.DOWNLOADS_DIR || 'downloads'),
};

const extractorConfigs = {};

export function getExtractorConfig(extractorId) {
  return extractorConfigs[extractorId] || {
    proxy: '',
    downloadProxy: '',
    edgeProxy: '',
    disableProxy: false,
    ignoreRegex: [],
    impersonate: false,
    isDisabled: false,
    instance: [],
  };
}

export function setExtractorConfig(extractorId, cfg) {
  extractorConfigs[extractorId] = cfg;
}
