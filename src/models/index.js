import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { Env } from '../config/index.js';
import { MediaType, MediaCodec } from '../database/index.js';

// ── FileType / FileExtension ──────────────────────────────────────────────────

export const FileType = {
  Document: 'document',
  Photo: 'photo',
  Video: 'video',
  Audio: 'audio',
};

export const FileExtension = {
  MP4: 'mp4', WEBM: 'webm', MP3: 'mp3', M4A: 'm4a',
  FLAC: 'flac', OGG: 'oga', JPEG: 'jpeg', WEBP: 'webp',
  JPG: 'jpg', GIF: 'gif',
};

// ── FilesTracker ──────────────────────────────────────────────────────────────

export class FilesTracker {
  constructor() { this.files = new Set(); }

  add(filePath) { this.files.add(filePath); }

  cleanup() {
    for (const f of this.files) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
    this.files.clear();
  }
}

// ── MediaFormat ───────────────────────────────────────────────────────────────

export class MediaFormat {
  constructor() {
    this.formatId = '';
    this.fileId = '';
    this.type = MediaType.Video;
    this.audioCodec = '';
    this.videoCodec = '';
    this.fileSize = 0;
    this.duration = 0;
    this.title = '';
    this.artist = '';
    this.width = 0;
    this.height = 0;
    this.bitrate = 0;
    this.url = [];
    this.thumbnailUrl = [];
    this.downloadSettings = null;
    this.plugins = [];
    this.initSegment = '';
    this.segments = [];
    this.decryptionKey = null;
  }

  getInfo() {
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

  getFileName() {
    const [ext] = this.getInfo();
    if (this.type === MediaType.Audio && this.title && this.artist) {
      const artist = this.artist.replace(/\//g, ' ');
      const title = this.title.replace(/\//g, ' ');
      const uid = uuidv4().replace(/-/g, '').toUpperCase().slice(0, 8);
      return `${artist} - ${title} [${uid}].${ext}`;
    }
    return `${uuidv4().replace(/-/g, '')}.${ext}`;
  }

  missingMetadata() {
    if (this.type === MediaType.Video) {
      return this.width === 0 || this.height === 0 || this.duration === 0;
    }
    return false;
  }

  toString() {
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
  constructor() { this.formats = []; }

  addFormats(...formats) { this.formats.push(...formats); }

  getFormatById(formatId) { return this.formats.find(f => f.formatId === formatId) || null; }

  getDefaultFormat() {
    return this.getDefaultVideoFormat() || this.getDefaultAudioFormat() || this.getDefaultPhotoFormat() || null;
  }

  getDefaultVideoFormat() {
    let filtered = this.formats.filter(f => f.videoCodec === MediaCodec.Avc);
    if (!filtered.length) filtered = this.formats.filter(f => f.videoCodec !== '');
    if (!filtered.length) return null;
    filtered.sort((a, b) => {
      if (a.bitrate !== b.bitrate) return b.bitrate - a.bitrate;
      return b.height - a.height;
    });
    return filtered[0];
  }

  getDefaultAudioFormat() {
    let filtered = this.formats.filter(
      f => f.videoCodec === '' && (f.audioCodec === MediaCodec.Aac || f.audioCodec === MediaCodec.Mp3)
    );
    if (!filtered.length) filtered = this.formats.filter(f => f.videoCodec === '' && f.audioCodec !== '');
    if (!filtered.length) return null;
    return filtered.reduce((best, f) => f.bitrate > best.bitrate ? f : best, filtered[0]);
  }

  getDefaultPhotoFormat() {
    const filtered = this.formats.filter(f => f.type === MediaType.Photo);
    return filtered[0] || null;
  }

  filterFormats(condition) { return this.formats.filter(condition); }
}

// ── Media ─────────────────────────────────────────────────────────────────────

export class Media {
  constructor() {
    this.contentId = '';
    this.contentUrl = '';
    this.extractorId = '';
    this.caption = '';
    this.nsfw = false;
    this.items = [];
  }

  newItem() {
    const item = new MediaItem();
    this.items.push(item);
    return item;
  }

  setCaption(caption) {
    if (!this.caption) this.caption = caption || '';
  }

  setNSFW() { this.nsfw = true; }
}

// ── ExtractorContext ──────────────────────────────────────────────────────────

export class ExtractorContext {
  constructor({ contentId, contentUrl, matchGroups, extractor, config, httpClient, chat = null } = {}) {
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

  cancel() { this.abortController.abort(); }

  key() { return `${this.extractor.id}/${this.contentId}`; }

  setChat(chat) { this.chat = chat; }

  newMedia() {
    const m = new Media();
    m.contentId = this.contentId;
    m.contentUrl = this.contentUrl;
    m.extractorId = this.extractor.id;
    return m;
  }

  logPrefix() {
    const url = this.contentUrl;
    const id = this.extractor.id;
    return this.chat ? `[${url}] [${this.chat.chatId}] ${id}` : `[${url}] ${id}`;
  }

  debug(msg) { import('../logger/index.js').then(({ logger }) => logger.debug(`${this.logPrefix()}: ${msg}`)); }
  info(msg)  { import('../logger/index.js').then(({ logger }) => logger.info(`${this.logPrefix()}: ${msg}`)); }
  warn(msg)  { import('../logger/index.js').then(({ logger }) => logger.warn(`${this.logPrefix()}: ${msg}`)); }
  error(msg) { import('../logger/index.js').then(({ logger }) => logger.error(`${this.logPrefix()}: ${msg}`)); }

  async fetch(method, url, params = {}) {
    return this.httpClient.fetch(method, url, params);
  }

  async fetchLocation(url, params = {}) {
    const resp = await this.fetch('GET', url, params);
    return resp.request?.res?.responseUrl || resp.config?.url || url;
  }
}

// ── DownloadSettings ──────────────────────────────────────────────────────────

export class DownloadSettings {
  constructor({ headers, cookies, decryptionKey } = {}) {
    this.headers = headers || {};
    this.cookies = cookies || [];
    this.decryptionKey = decryptionKey || null;
  }
}

// ── DownloadedFormat ──────────────────────────────────────────────────────────

export class DownloadedFormat {
  constructor({ format, index, filePath = '', thumbnailFilePath = '', error = null } = {}) {
    this.format = format;
    this.index = index;
    this.filePath = filePath;
    this.thumbnailFilePath = thumbnailFilePath;
    this.error = error;
  }
}

// ── Extractor ─────────────────────────────────────────────────────────────────

export class Extractor {
  constructor({ id, displayName, urlPattern, host, hidden = false, redirect = false, getFunc }) {
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

export class TaskResult {
  constructor({ media, formats, isStored = false } = {}) {
    this.media = media;
    this.formats = formats;
    this.isStored = isStored;
  }
}

// ── SendFormatsOptions ────────────────────────────────────────────────────────

export class SendFormatsOptions {
  constructor({ caption = '', isSpoiler = false, isStored = false, delete: del = false } = {}) {
    this.caption = caption;
    this.isSpoiler = isSpoiler;
    this.isStored = isStored;
    this.delete = del;
  }
}
