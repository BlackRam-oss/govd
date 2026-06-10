/**
 * In-memory store - sostituisce PostgreSQL.
 * Quando DB_HOST/PORT/ecc. sono impostati vengono letti ma non usati:
 * tutte le operazioni avvengono su Map/variabili in-memory.
 */

import { Env } from '../config/index.js';
import logger from '../logger/index.js';

// ── tipi (equivalenti degli enum Go) ─────────────────────────────────────────

export const ChatType = { Private: 'private', Group: 'group' } as const;

export const MediaType = { Photo: 'photo', Video: 'video', Audio: 'audio' } as const;

export const MediaCodec = {
  Avc: 'avc', Hevc: 'hevc', Vp9: 'vp9', Vp8: 'vp8',
  Av1: 'av1', Webp: 'webp', Aac: 'aac', Opus: 'opus',
  Vorbis: 'vorbis', Mp3: 'mp3', Flac: 'flac',
} as const;

// ── interfaces ────────────────────────────────────────────────────────────────

export interface ChatRow {
  chatId: number;
  type: string;
  nsfw: boolean;
  mediaAlbumLimit: number;
  captions: boolean;
  silent: boolean;
  language: string;
  disabledExtractors: string[];
  deleteLinks: boolean;
}

export interface MediaRow {
  id: number;
  contentId: string;
  contentUrl: string;
  extractorId: string;
  caption: string;
  nsfw: boolean;
}

export interface MediaItemRow {
  id: number;
  mediaId: number;
}

export interface MediaFormatRow {
  formatId: string;
  fileId: string;
  type: string;
  audioCodec: string;
  videoCodec: string;
  duration: number;
  fileSize: number;
  title: string;
  artist: string;
  width: number;
  height: number;
  bitrate: number;
}

interface MediaItemEntry {
  id: number;
  formats: MediaFormatRow[];
}

interface MediaEntry extends MediaRow {
  items: MediaItemEntry[];
  createdAt: Date;
}

interface ErrorEntry {
  message: string;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
}

interface Stats {
  totalPrivateChats: number;
  totalGroupChats: number;
  totalDownloads: number;
  totalDownloadsSize: number;
  privateChatsByLanguage: Record<string, number>;
  groupChatsByLanguage: Record<string, number>;
}

// ── store ─────────────────────────────────────────────────────────────────────

const chatStore = new Map<string, ChatRow>();   // chatId (number) → ChatRow
const mediaStore = new Map<string, MediaEntry>();  // `${extractorId}:${contentId}` → MediaEntry
const errorStore = new Map<string, ErrorEntry>();  // errorId → { message, occurrences, firstSeen, lastSeen }

const stats: Stats = {
  totalPrivateChats: 0,
  totalGroupChats: 0,
  totalDownloads: 0,
  totalDownloadsSize: 0,
  privateChatsByLanguage: {},
  groupChatsByLanguage: {},
};

let mediaIdCounter = 1;
let itemIdCounter = 1;

// ── helpers ───────────────────────────────────────────────────────────────────

function defaultSettings(
  chatId: number,
  type: string,
  language: string,
  captions: boolean,
  silent: boolean,
  nsfw: boolean,
  mediaAlbumLimit: number,
  deleteLinks: boolean,
): ChatRow {
  return {
    chatId,
    type,
    nsfw,
    mediaAlbumLimit,
    captions,
    silent,
    language,
    disabledExtractors: [],
    deleteLinks,
  };
}

function chatKey(chatId: number): string { return String(chatId); }

function mediaKey(extractorId: string, contentId: string): string { return `${extractorId}:${contentId}`; }

// ── funzioni database ─────────────────────────────────────────────────────────

export function getOrCreateChat(
  chatId: number,
  type: string,
  language: string,
  captions: boolean,
  silent: boolean,
  nsfw: boolean,
  mediaAlbumLimit: number,
  deleteLinks: boolean,
): ChatRow {
  const key = chatKey(chatId);
  if (chatStore.has(key)) {
    const existing = chatStore.get(key)!;
    // aggiorna lingua se era 'XX' (auto-detect)
    if (existing.language === 'XX') {
      existing.language = language;
      chatStore.set(key, existing);
    }
    return existing;
  }

  const row = defaultSettings(chatId, type, language, captions, silent, nsfw, mediaAlbumLimit, deleteLinks);
  chatStore.set(key, row);

  if (type === ChatType.Private) {
    stats.totalPrivateChats++;
    stats.privateChatsByLanguage[language] = (stats.privateChatsByLanguage[language] || 0) + 1;
  } else {
    stats.totalGroupChats++;
    stats.groupChatsByLanguage[language] = (stats.groupChatsByLanguage[language] || 0) + 1;
  }

  logger.debug({ chatId, type }, 'chat created in memory');
  return row;
}

export function getMediaByContentID(contentId: string, extractorId: string): MediaRow | null {
  const entry = mediaStore.get(mediaKey(extractorId, contentId));
  if (!entry) return null;
  return {
    id: entry.id,
    contentId: entry.contentId,
    contentUrl: entry.contentUrl,
    extractorId: entry.extractorId,
    caption: entry.caption,
    nsfw: entry.nsfw,
  };
}

export function createMedia(
  extractorId: string,
  contentUrl: string,
  contentId: string,
  caption: string,
  nsfw: boolean,
): number {
  const key = mediaKey(extractorId, contentId);
  if (mediaStore.has(key)) {
    logger.debug({ contentId }, 'media already exists in memory');
    return mediaStore.get(key)!.id;
  }
  const id = mediaIdCounter++;
  mediaStore.set(key, {
    id,
    contentId,
    contentUrl,
    extractorId,
    caption: caption || '',
    nsfw: nsfw || false,
    items: [],
    createdAt: new Date(),
  });
  return id;
}

export function createMediaItem(mediaId: number): number {
  const id = itemIdCounter++;
  for (const entry of mediaStore.values()) {
    if (entry.id === mediaId) {
      entry.items.push({ id, formats: [] });
      break;
    }
  }
  return id;
}

export function createMediaFormat(
  itemId: number,
  formatId: string,
  fileId: string,
  type: string,
  audioCodec: string,
  videoCodec: string,
  duration: number,
  fileSize: number,
  title: string,
  artist: string,
  width: number,
  height: number,
  bitrate: number,
): void {
  for (const entry of mediaStore.values()) {
    for (const item of entry.items) {
      if (item.id === itemId) {
        item.formats.push({ formatId, fileId, type, audioCodec, videoCodec, duration, fileSize, title, artist, width, height, bitrate });
        stats.totalDownloads++;
        if (fileSize) stats.totalDownloadsSize += fileSize;
        return;
      }
    }
  }
}

export function getMediaItems(mediaId: number): MediaItemRow[] {
  for (const entry of mediaStore.values()) {
    if (entry.id === mediaId) {
      return entry.items.map(i => ({ id: i.id, mediaId }));
    }
  }
  return [];
}

export function getMediaFormat(itemId: number): MediaFormatRow | null {
  for (const entry of mediaStore.values()) {
    for (const item of entry.items) {
      if (item.id === itemId && item.formats.length > 0) {
        return item.formats[0];
      }
    }
  }
  return null;
}

// ── settings ──────────────────────────────────────────────────────────────────

function getChat(chatId: number): ChatRow | undefined {
  return chatStore.get(chatKey(chatId));
}

export function toggleChatCaptions(chatId: number): void {
  const c = getChat(chatId);
  if (c) { c.captions = !c.captions; }
}

export function toggleChatNsfw(chatId: number): void {
  const c = getChat(chatId);
  if (c) { c.nsfw = !c.nsfw; }
}

export function toggleChatSilentMode(chatId: number): void {
  const c = getChat(chatId);
  if (c) { c.silent = !c.silent; }
}

export function toggleChatDeleteLinks(chatId: number): void {
  const c = getChat(chatId);
  if (c) { c.deleteLinks = !c.deleteLinks; }
}

export function setChatLanguage(chatId: number, language: string): void {
  const c = getChat(chatId);
  if (c) { c.language = language; }
}

export function setChatMediaAlbumLimit(chatId: number, limit: number): void {
  const c = getChat(chatId);
  if (c) { c.mediaAlbumLimit = limit; }
}

export function addDisabledExtractor(chatId: number, extractorId: string): void {
  const c = getChat(chatId);
  if (c && !c.disabledExtractors.includes(extractorId)) {
    c.disabledExtractors.push(extractorId);
  }
}

export function removeDisabledExtractor(chatId: number, extractorId: string): void {
  const c = getChat(chatId);
  if (c) {
    c.disabledExtractors = c.disabledExtractors.filter(e => e !== extractorId);
  }
}

// ── stats ─────────────────────────────────────────────────────────────────────

export function getStats(_sinceDate?: Date): Stats {
  return { ...stats };
}

// ── error log ─────────────────────────────────────────────────────────────────

export function logError(id: string, message: string): void {
  if (errorStore.has(id)) {
    const e = errorStore.get(id)!;
    e.occurrences++;
    e.lastSeen = new Date();
  } else {
    errorStore.set(id, { message, occurrences: 1, firstSeen: new Date(), lastSeen: new Date() });
  }
}

// ── init ──────────────────────────────────────────────────────────────────────

export function init(): void {
  const hasDbConfig = Env.DBHost && Env.DBName && Env.DBUser;
  if (hasDbConfig) {
    logger.info('DB vars rilevate ma non usate: storage in-memory attivo');
  } else {
    logger.info('storage in-memory attivo (nessun DB configurato)');
  }
}

export default {
  init,
  getOrCreateChat,
  getMediaByContentID,
  createMedia,
  createMediaItem,
  createMediaFormat,
  getMediaItems,
  getMediaFormat,
  toggleChatCaptions,
  toggleChatNsfw,
  toggleChatSilentMode,
  toggleChatDeleteLinks,
  setChatLanguage,
  setChatMediaAlbumLimit,
  addDisabledExtractor,
  removeDisabledExtractor,
  getStats,
  logError,
  ChatType,
  MediaType,
  MediaCodec,
};
