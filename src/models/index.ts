import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { Env } from '../config/index.js';
import { MediaType, MediaCodec, ChatRow } from '../database/index.js';
import type { HTTPClient, FetchParams, Cookie } from '../networking/index.js';

// ── FileType / FileExtension ──────────────────────────────────────────────────

export const FileType = {
  Document: 'document',
  Photo: 'photo',
  Video: 'video',
  Audio: 'audio',
} as const;

export const FileExtension = {
  MP4: 'mp4', WEBM: 'webm', MP3: 'mp3', M4A: 'm4a',
  FLAC: 'flac', OGG: 'oga', JPEG: 'jpeg', WEBP: 'webp',
  JPG: 'jpg', GIF: 'gif',
} as const;

// ── ExtractorConfig / Plugin interfaces ───────────────────────────────────────

export interface ExtractorConfig {
  proxy: string;
  downloadProxy: string;
  edgeProxy: string;
  disableProxy: boolean;
  ignoreRegex: RegExp[];
  impersonate: boolean;
  isDisabled: boolean;
  instance: string[];
}

export interface Plugin {
  id: string;
  runFunc(ctx: ExtractorContext, item: MediaItem, downloaded: DownloadedFormat): Promise<void>;
}

// ── FilesTracker ──────────────────────────────────────────────────────────────

export class FilesTracker {
  files: Set<string> = new Set();

  add(filePath: string): void { this.files.add(filePath); }

  cleanup(): void {
    for (const f of this.files) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
    this.files.clear();
  }
}

// ── MediaFormat ───────────────────────────────────────────────────────────────

export class MediaFormat {
  formatId: string = '';
  fileId: string = '';
  type: string = MediaType.Video;
  audioCodec: string = '';
  videoCodec: string = '';
  fileSize: number = 0;
  duration: number = 0;
  title: string = '';
  artist: string = '';
  width: number = 0;
  height: number = 0;
  bitrate: number = 0;
  url: string[] = [];
  thumbnailUrl: string[] = [];
  downloadSettings: DownloadSettings | null = null;
  plugins: Plugin[] = [];
  initSegment: string = '';
  segments: string[] = [];
  decryptionKey: Buffer | null = null;

  getInfo(): [string, string] {
    if (this.type === MediaType.Photo) {
      if (this.width > 0 && this.height > 0) {
        if (this.width + this.height > 10000) return [FileExtension.JPEG, FileType.Document];
        if (Math.max(this.width, this.height) > Math.min(this.width, this.height) * 20)
          return [FileExtension.JPEG, FileType.Document];
      }
      return [FileExtension.JPEG, FileType.Photo];
    }

    const v = this.videoCodec;
    const a = this.audioCodec;

    if (v === MediaCodec.Avc && (a === MediaCodec.Aac || a === MediaCodec.Mp3 || a === ''))
      return [FileExtension.MP4, FileType.Video];
    if (v === MediaCodec.Hevc) return [FileExtension.MP4, FileType.Document];
    if (v === MediaCodec.Webp && a === '') return [FileExtension.WEBP, FileType.Video];
    if (v === '' && a === MediaCodec.Mp3) return [FileExtension.MP3, FileType.Audio];
    if (v === '' && a === MediaCodec.Aac) return [FileExtension.M4A, FileType.Audio];
    if (v === '' && a === MediaCodec.Flac) return [FileExtension.FLAC, FileType.Document];
    if (v === '' && a === MediaCodec.Vorbis) return [FileExtension.OGG, FileType.Document];

    return [FileExtension.WEBM, FileType.Document];
  }

  getFileName(): string {
    const [ext] = this.getInfo();
    if (this.type === MediaType.Audio && this.title && this.artist) {
      const artist = this.artist.replace(/\//g, ' ');
      const title = this.title.replace(/\//g, ' ');
      const uid = uuidv4().replace(/-/g, '').toUpperCase().slice(0, 8);
      return `${artist} - ${title} [${uid}].${ext}`;
    }
    return `${uuidv4().replace(/-/g, '')}.${ext}`;
  }

  missingMetadata(): boolean {
    if (this.type === MediaType.Video) {
      return this.width === 0 || this.height === 0 || this.duration === 0;
    }
    return false;
  }

  toString(): string {
    const parts = [`id: ${this.formatId}`, `type: ${this.type}`];
    if (this.width && this.height) parts.push(`resolution: ${this.width}x${this.height}`);
    if (this.duration) parts.push(`duration: ${this.duration}s`);
    if (this.videoCodec) parts.push(`video: ${this.videoCodec}`);
    if (this.audioCodec) parts.push(`audio: ${this.audioCodec}`);
    if (this.bitrate) parts.push(`bitrate: ${(this.bitrate / 1000).toFixed(0)}kbps`);
    if (this.fileSize) parts.push(`size: ${(this.fileSize / (1024 * 1024)).toFixed(1)}MB`);
    return `[${parts.join(', ')}]`;
  }
}

// ── MediaItem ─────────────────────────────────────────────────────────────────

export class MediaItem {
  formats: MediaFormat[] = [];

  addFormats(...formats: MediaFormat[]): void { this.formats.push(...formats); }

  getFormatById(formatId: string): MediaFormat | null { return this.formats.find(f => f.formatId === formatId) || null; }

  getDefaultFormat(): MediaFormat | null {
    return this.getDefaultVideoFormat() || this.getDefaultAudioFormat() || this.getDefaultPhotoFormat() || null;
  }

  getDefaultVideoFormat(): MediaFormat | null {
    let filtered = this.formats.filter(f => f.videoCodec === MediaCodec.Avc);
    if (!filtered.length) filtered = this.formats.filter(f => f.videoCodec !== '');
    if (!filtered.length) return null;
    filtered.sort((a, b) => {
      if (a.bitrate !== b.bitrate) return b.bitrate - a.bitrate;
      return b.height - a.height;
    });
    return filtered[0];
  }

  getDefaultAudioFormat(): MediaFormat | null {
    let filtered = this.formats.filter(
      f => f.videoCodec === '' && (f.audioCodec === MediaCodec.Aac || f.audioCodec === MediaCodec.Mp3)
    );
    if (!filtered.length) filtered = this.formats.filter(f => f.videoCodec === '' && f.audioCodec !== '');
    if (!filtered.length) return null;
    return filtered.reduce((best, f) => f.bitrate > best.bitrate ? f : best, filtered[0]);
  }

  getDefaultPhotoFormat(): MediaFormat | null {
    const filtered = this.formats.filter(f => f.type === MediaType.Photo);
    return filtered[0] || null;
  }

  filterFormats(condition: (f: MediaFormat) => boolean): MediaFormat[] { return this.formats.filter(condition); }
}

// ── Media ─────────────────────────────────────────────────────────────────────

export class Media {
  contentId: string = '';
  contentUrl: string = '';
  extractorId: string = '';
  caption: string = '';
  nsfw: boolean = false;
  items: MediaItem[] = [];

  newItem(): MediaItem {
    const item = new MediaItem();
    this.items.push(item);
    return item;
  }

  setCaption(caption: string): void {
    if (!this.caption) this.caption = caption || '';
  }

  setNSFW(): void { this.nsfw = true; }
}

// ── ExtractorContext ──────────────────────────────────────────────────────────

interface ExtractorContextParams {
  contentId?: string;
  contentUrl?: string;
  matchGroups?: Record<string, string>;
  extractor: Extractor;
  config: ExtractorConfig;
  httpClient: HTTPClient;
  chat?: ChatRow | null;
}

export class ExtractorContext {
  contentId: string;
  contentUrl: string;
  matchGroups: Record<string, string>;
  extractor: Extractor;
  config: ExtractorConfig;
  httpClient: HTTPClient;
  chat: ChatRow | null;
  filesTracker: FilesTracker;
  downloadFunc: ((ctx: ExtractorContext, index: number, format: MediaFormat) => Promise<DownloadedFormat>) | null;
  abortController: AbortController;
  signal: AbortSignal;

  constructor({ contentId, contentUrl, matchGroups, extractor, config, httpClient, chat = null }: ExtractorContextParams) {
    this.contentId = contentId || '';
    this.contentUrl = contentUrl || '';
    this.matchGroups = matchGroups || {};
    this.extractor = extractor;
    this.config = config;
    this.httpClient = httpClient;
    this.chat = chat;
    this.filesTracker = new FilesTracker();
    this.downloadFunc = null;
    this.abortController = new AbortController();
    this.signal = this.abortController.signal;
  }

  cancel(): void { this.abortController.abort(); }

  key(): string { return `${this.extractor.id}/${this.contentId}`; }

  setChat(chat: ChatRow | null): void { this.chat = chat; }

  newMedia(): Media {
    const m = new Media();
    m.contentId = this.contentId;
    m.contentUrl = this.contentUrl;
    m.extractorId = this.extractor.id;
    return m;
  }

  logPrefix(): string {
    const url = this.contentUrl;
    const id = this.extractor.id;
    return this.chat ? `[${url}] [${this.chat.chatId}] ${id}` : `[${url}] ${id}`;
  }

  debug(msg: string): void { import('../logger/index.js').then(({ logger }) => logger.debug(`${this.logPrefix()}: ${msg}`)); }
  info(msg: string): void  { import('../logger/index.js').then(({ logger }) => logger.info(`${this.logPrefix()}: ${msg}`)); }
  warn(msg: string): void  { import('../logger/index.js').then(({ logger }) => logger.warn(`${this.logPrefix()}: ${msg}`)); }
  error(msg: string): void { import('../logger/index.js').then(({ logger }) => logger.error(`${this.logPrefix()}: ${msg}`)); }

  async fetch(method: string, url: string, params: FetchParams = {}): Promise<any> {
    return this.httpClient.fetch(method, url, params);
  }

  async fetchLocation(url: string): Promise<string> {
    const resp = await fetch(url, { redirect: 'follow' });
    return resp.url || url;
  }
}

// ── DownloadSettings ──────────────────────────────────────────────────────────

interface DownloadSettingsParams {
  headers?: Record<string, string>;
  cookies?: Cookie[];
  decryptionKey?: Buffer | null;
}

export class DownloadSettings {
  headers: Record<string, string>;
  cookies: Cookie[];
  decryptionKey: Buffer | null;

  constructor({ headers, cookies, decryptionKey }: DownloadSettingsParams = {}) {
    this.headers = headers || {};
    this.cookies = cookies || [];
    this.decryptionKey = decryptionKey || null;
  }
}

// ── DownloadedFormat ──────────────────────────────────────────────────────────

interface DownloadedFormatParams {
  format?: MediaFormat;
  index: number;
  filePath?: string;
  thumbnailFilePath?: string;
  buffer?: Uint8Array | null;
  error?: Error | null;
}

export class DownloadedFormat {
  format: MediaFormat;
  index: number;
  filePath: string;
  thumbnailFilePath: string;
  buffer: Uint8Array | null;
  error: Error | null;

  constructor({ format, index, filePath = '', thumbnailFilePath = '', buffer = null, error = null }: DownloadedFormatParams) {
    this.format = format ?? new MediaFormat();
    this.index = index;
    this.filePath = filePath;
    this.thumbnailFilePath = thumbnailFilePath;
    this.buffer = buffer;
    this.error = error;
  }
}

// ── Extractor ─────────────────────────────────────────────────────────────────

interface ExtractorParams {
  id: string;
  displayName: string;
  urlPattern: RegExp;
  host: string[];
  hidden?: boolean;
  redirect?: boolean;
  getFunc: (ctx: ExtractorContext) => Promise<{ media?: Media; url?: string }>;
}

export class Extractor {
  id: string;
  displayName: string;
  urlPattern: RegExp;
  host: string[];
  hidden: boolean;
  redirect: boolean;
  getFunc: (ctx: ExtractorContext) => Promise<{ media?: Media; url?: string }>;

  constructor({ id, displayName, urlPattern, host, hidden = false, redirect = false, getFunc }: ExtractorParams) {
    this.id = id;
    this.displayName = displayName;
    this.urlPattern = urlPattern;
    this.host = host;
    this.hidden = hidden;
    this.redirect = redirect;
    this.getFunc = getFunc;
  }
}

// ── TaskResult ────────────────────────────────────────────────────────────────

interface TaskResultParams {
  media: Media;
  formats: DownloadedFormat[];
  isStored?: boolean;
}

export class TaskResult {
  media: Media;
  formats: DownloadedFormat[];
  isStored: boolean;

  constructor({ media, formats, isStored = false }: TaskResultParams) {
    this.media = media;
    this.formats = formats;
    this.isStored = isStored;
  }
}

// ── SendFormatsOptions ────────────────────────────────────────────────────────

interface SendFormatsOptionsParams {
  caption?: string;
  isSpoiler?: boolean;
  isStored?: boolean;
  delete?: boolean;
}

export class SendFormatsOptions {
  caption: string;
  isSpoiler: boolean;
  isStored: boolean;
  delete: boolean;

  constructor({ caption = '', isSpoiler = false, isStored = false, delete: del = false }: SendFormatsOptionsParams = {}) {
    this.caption = caption;
    this.isSpoiler = isSpoiler;
    this.isStored = isStored;
    this.delete = del;
  }
}
