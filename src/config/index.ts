import { config } from 'dotenv';
import path from 'path';

config();

function parseIntEnv(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (!val) return defaultVal;
  const n = parseInt(val, 10);
  return isNaN(n) ? defaultVal : n;
}

function parseBoolEnv(key: string, defaultVal: boolean): boolean {
  const val = process.env[key];
  if (!val) return defaultVal;
  return val.toLowerCase() === 'true' || val === '1';
}

function parseListEnv(key: string): number[] {
  const val = process.env[key];
  if (!val || val.trim() === '') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(n => !isNaN(n));
}

function parseStringListEnv(key: string): string[] {
  const val = process.env[key];
  if (!val || val.trim() === '') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

interface EnvConfig {
  DBHost: string;
  DBPort: number;
  DBName: string;
  DBUser: string;
  DBPassword: string;

  BotToken: string;
  BotAPIURL: string;
  ConcurrentUpdates: number;

  DownloadsDirectory: string;

  Proxy: string;

  MaxDuration: number;
  MaxFileSize: number;
  RepoURL: string;
  LogLevel: string;

  Whitelist: number[];
  Admins: number[];

  Caching: boolean;

  CaptionsHeader: string;
  CaptionsDescription: string;

  DefaultCaptions: boolean;
  DefaultSilent: boolean;
  DefaultNSFW: boolean;
  DefaultMediaAlbumLimit: number;
  DefaultLanguage: string;

  AutomaticLanguageDetection: boolean;

  TwitterBearerToken: string;

  DownloadsDir: string;
}

export const Env: EnvConfig = {
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

  AutomaticLanguageDetection: parseBoolEnv('AUTOMATIC_LANGUAGE_DETECTION', true),

  TwitterBearerToken: process.env.TWITTER_BEARER_TOKEN || '',

  DownloadsDir: path.resolve(process.env.DOWNLOADS_DIR || 'downloads'),
};

import type { ExtractorConfig } from '../models/index.js';

const extractorConfigs: Record<string, ExtractorConfig> = {};

export function getExtractorConfig(extractorId: string): ExtractorConfig {
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

export function setExtractorConfig(extractorId: string, cfg: ExtractorConfig): void {
  extractorConfigs[extractorId] = cfg;
}
