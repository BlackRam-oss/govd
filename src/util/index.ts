import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { parse as tldtsParse } from 'tldts';
import { Env } from '../config/index.js';
import { MediaCodec } from '../database/index.js';
import logger from '../logger/index.js';

const execAsync = promisify(exec);

// ── URL utils ─────────────────────────────────────────────────────────────────

export function extractBaseHost(rawURL: string): string | null {
  try {
    const parsed = new URL(rawURL);
    const result = tldtsParse(parsed.hostname);
    return result.domain?.split('.')[0] || null;
  } catch {
    return null;
  }
}

export function getNamedGroups(pattern: RegExp, str: string): (Record<string, string> & { match: string }) | null {
  const match = str.match(pattern);
  if (!match) return null;
  return { ...match.groups, match: match[0] };
}

export function unescapeURL(url: string): string {
  return url.replace(/&amp;/g, '&');
}

// ── validation ────────────────────────────────────────────────────────────────

export function exceedsMaxFileSize(fileSize: number): boolean {
  return fileSize > Env.MaxFileSize;
}

export function exceedsMaxDuration(duration: number): boolean {
  return duration > Env.MaxDuration;
}

// ── codec parsing ─────────────────────────────────────────────────────────────

export function parseVideoCodec(codecs: string): string {
  const c = codecs.toLowerCase();
  if (c.includes('avc') || c.includes('h264')) return MediaCodec.Avc;
  if (c.includes('hvc') || c.includes('h265') || c.includes('hev1')) return MediaCodec.Hevc;
  if (c.includes('av01')) return MediaCodec.Av1;
  if (c.includes('vp9')) return MediaCodec.Vp9;
  if (c.includes('vp8')) return MediaCodec.Vp8;
  return '';
}

export function parseAudioCodec(codecs: string): string {
  const c = codecs.toLowerCase();
  if (c.includes('mp4a')) return MediaCodec.Aac;
  if (c.includes('opus')) return MediaCodec.Opus;
  if (c.includes('mp3')) return MediaCodec.Mp3;
  if (c.includes('flac')) return MediaCodec.Flac;
  if (c.includes('vorbis')) return MediaCodec.Vorbis;
  return '';
}

// ── random ────────────────────────────────────────────────────────────────────

export function randomBase64(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, b => chars[b & 63]).join('');
}

export function randomAlphaString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(length * 2);
  let result = '';
  for (const b of bytes) {
    if (b < 208) { result += chars[b % 52]; if (result.length >= length) break; }
  }
  return result.padEnd(length, 'a');
}

// ── hex ───────────────────────────────────────────────────────────────────────

export function parseHex(str: string): Buffer {
  const clean = str.startsWith('0x') || str.startsWith('0X') ? str.slice(2) : str;
  const buf = Buffer.from(clean, 'hex');
  if (buf.length !== 16) throw new Error(`IV must be 16 bytes, got ${buf.length}`);
  return buf;
}

// ── FFmpeg ────────────────────────────────────────────────────────────────────

export function checkFFmpeg(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ── cleanup ───────────────────────────────────────────────────────────────────

export function cleanupDownloads(ignoreTime: boolean = false): void {
  const dir = Env.DownloadsDir;
  if (!dir) return;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fp = path.join(dir, file);
      try {
        const stat = fs.statSync(fp);
        const age = Date.now() - stat.mtimeMs;
        if (ignoreTime || age > 10 * 60 * 1000) {
          if (stat.isDirectory()) fs.rmSync(fp, { recursive: true });
          else fs.unlinkSync(fp);
        }
      } catch {}
    }
  } catch {}
}

export function cleanupDownloadsJob(): void {
  cleanupDownloads(true);
  setInterval(() => cleanupDownloads(false), 10 * 60 * 1000);
}

// ── hashed error ──────────────────────────────────────────────────────────────

export function hashedError(err: unknown): string {
  const msg = (err as Error)?.message || String(err);
  return crypto.createHash('sha256').update(msg).digest('hex').slice(0, 8).toUpperCase();
}

// ── Telegram utils ────────────────────────────────────────────────────────────

interface MessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
}

interface TelegramMessage {
  text?: string;
  entities?: MessageEntity[];
}

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
}

interface TelegramFile {
  file_id: string;
  file_size?: number;
}

interface TelegramMessageWithMedia {
  video?: TelegramFile;
  audio?: TelegramFile;
  photo?: TelegramFile[];
  document?: TelegramFile;
  animation?: TelegramFile;
}

export function urlFromMessage(message: TelegramMessage): string {
  const entities = message.entities || [];
  for (const entity of entities) {
    if (entity.type === 'url') {
      return message.text?.slice(entity.offset, entity.offset + entity.length) || '';
    }
    if (entity.type === 'text_link') {
      return entity.url || '';
    }
  }
  return '';
}

export function hasHashtagEntity(message: TelegramMessage, hashtag: string): boolean {
  const entities = message.entities || [];
  const text = message.text || '';
  for (const entity of entities) {
    if (entity.type === 'hashtag') {
      const tag = text.slice(entity.offset + 1, entity.offset + entity.length);
      if (tag.toLowerCase() === hashtag.toLowerCase()) return true;
    }
  }
  return false;
}

export function mentionUser(user: TelegramUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return `<a href="tg://user?id=${user.id}">${name}</a>`;
}

export function getMessageFileId(message: TelegramMessageWithMedia): string {
  if (message.video) return message.video.file_id;
  if (message.audio) return message.audio.file_id;
  if (message.photo) return message.photo[message.photo.length - 1]?.file_id || '';
  if (message.document) return message.document.file_id;
  if (message.animation) return message.animation.file_id;
  return '';
}

export function getMessageFileSize(message: TelegramMessageWithMedia): number {
  if (message.video) return message.video.file_size || 0;
  if (message.audio) return message.audio.file_size || 0;
  if (message.document) return message.document.file_size || 0;
  return 0;
}

// ── errors ────────────────────────────────────────────────────────────────────

export class BotError extends Error {
  id: string;

  constructor(id: string, message: string) {
    super(message);
    this.id = id;
    this.name = 'BotError';
  }
}

export const Errors = {
  Unavailable:                  new BotError('ErrorUnavailable', 'this content is unavailable'),
  Timeout:                      new BotError('ErrorTimeout', 'timeout error when downloading'),
  UnsupportedImageFormat:       new BotError('ErrorUnsupportedImageFormat', 'unsupported image format'),
  MediaAlbumLimitExceeded:      new BotError('ErrorMediaAlbumLimitExceeded', 'media album limit exceeded'),
  MediaAlbumGlobalLimitExceeded:new BotError('ErrorMediaAlbumGlobalLimitExceeded', 'global media album limit exceeded'),
  GeoRestricted:                new BotError('ErrorGeoRestrictedContent', 'geo-restricted content'),
  NSFWNotAllowed:               new BotError('ErrorNSFWNotAllowed', 'NSFW content not allowed'),
  InlineMediaAlbum:             new BotError('ErrorInlineMediaAlbum', 'media albums not supported in inline mode'),
  AuthenticationNeeded:         new BotError('ErrorAuthenticationNeeded', 'authentication required'),
  FileTooLarge:                 new BotError('ErrorFileTooLarge', 'file too large'),
  TelegramFileTooLarge:         new BotError('ErrorTelegramFileTooLarge', 'file too large for Telegram'),
  DurationTooLong:              new BotError('ErrorDurationTooLong', 'video too long'),
  PaidContent:                  new BotError('ErrorPaidContent', 'paid content'),
  AgeRestricted:                new BotError('ErrorAgeRestricted', 'age-restricted content'),
  PermissionDenied:             new BotError('ErrorPermissionDenied', 'bot lacks permissions'),
};

export function ptr<T>(v: T): T { return v; }
